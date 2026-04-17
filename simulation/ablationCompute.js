// ablationCompute.js 

let gl = null;
let ablationTex = null;
let ablationScratchTex = null;
let ablationFBO = null;
let ablateProgram = null;
let ablationQuadVAO = null;
let ablationQuadBuffer = null;

let aCompWidth = 0;
let aCompHeight = 0;
let aFullWidth = 0;
let aFullHeight = 0;
let aMx = 0, aMy = 0;
let aFullTexelIndex = null;

// ============================================================================
// SHADERS
// ============================================================================
const ablationQuadVS = `#version 300 es
layout(location = 0) in vec2 a_position;
out vec2 cc;
void main() {
    cc = a_position * 0.5 + 0.5;
    gl_Position = vec4(a_position, 0.0, 1.0);
}`;

const ablateFS = `#version 300 es
precision highp float;
precision highp int;
precision highp usampler2D;

in vec2 cc;

// current ablation map — accumulated lesion mask
uniform sampler2D   iAblation;
uniform usampler2D  fullTexelIndex;

uniform ivec3 ablateCenter;
uniform float ablateRadius;
uniform int   mx, my;
uniform int   fullWidth, fullHeight;

layout(location = 0) out vec4 oAblation;

void main() {
    ivec2 isize    = textureSize(iAblation, 0);
    ivec2 texelPos = ivec2(cc * vec2(isize));

    vec4 current = texelFetch(iAblation, texelPos, 0);

    uvec4 fullIdx = texelFetch(fullTexelIndex, texelPos, 0);
    if (fullIdx.w != uint(1)) {
        oAblation = current;
        return;
    }

    int nx   = fullWidth  / mx;
    int ny   = fullHeight / my;
    int texX = int(fullIdx.x);
    int texY = int(fullIdx.y);

    int blockX = texX / nx;
    int blockY = texY / ny;
    int x = texX % nx;
    int y = texY % ny;
    int z = blockX + (my - 1 - blockY) * mx;

    float dist = length(vec3(
        float(x - ablateCenter.x),
        float(y - ablateCenter.y),
        float(z - ablateCenter.z)
    ));

    if (dist < ablateRadius) {
        current.r = 1.0;  // mark as permanently ablated
    }

    oAblation = current;
}`;

// ============================================================================
// HELPERS
// ============================================================================
function makeTexture(width, height) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, width, height, 0, gl.RGBA, gl.FLOAT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
}

function makeFBO(tex) {
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
        console.error('[ablation] FBO incomplete:', status);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return fbo;
}

function compileShader(src, type) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        console.error('[ablation] Shader error:', gl.getShaderInfoLog(s));
        return null;
    }
    return s;
}

function makeProgram(vsSrc, fsSrc) {
    const vs = compileShader(vsSrc, gl.VERTEX_SHADER);
    const fs = compileShader(fsSrc, gl.FRAGMENT_SHADER);
    if (!vs || !fs) return null;
    const p = gl.createProgram();
    gl.attachShader(p, vs);
    gl.attachShader(p, fs);
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
        console.error('[ablation] Link error:', gl.getProgramInfoLog(p));
        return null;
    }
    return p;
}

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * @param {WebGL2RenderingContext} glContext
 * @param {object} params  { compWidth, compHeight, fullWidth, fullHeight, mx, my, fullTexelIndex }
 * @param {function} setAblationTexture  callback from cardiacCompute to register the ablation map
 */
export function initAblation(glContext, params, setAblationTexture) {
    gl = glContext;
    aCompWidth      = params.compWidth;
    aCompHeight     = params.compHeight;
    aFullWidth      = params.fullWidth;
    aFullHeight     = params.fullHeight;
    aMx             = params.mx;
    aMy             = params.my;
    aFullTexelIndex = params.fullTexelIndex;

    ablationTex = makeTexture(aCompWidth, aCompHeight);
    ablationScratchTex = makeTexture(aCompWidth, aCompHeight);
    const zeros = new Float32Array(aCompWidth * aCompHeight * 4);
    gl.bindTexture(gl.TEXTURE_2D, ablationTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, aCompWidth, aCompHeight, gl.RGBA, gl.FLOAT, zeros);
    gl.bindTexture(gl.TEXTURE_2D, ablationScratchTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, aCompWidth, aCompHeight, gl.RGBA, gl.FLOAT, zeros);

    ablationFBO = makeFBO(ablationScratchTex);
    const verts = new Float32Array([-1,-1, 1,-1, -1,1, 1,1]);
    ablationQuadBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, ablationQuadBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
    ablationQuadVAO = gl.createVertexArray();
    gl.bindVertexArray(ablationQuadVAO);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    ablateProgram = makeProgram(ablationQuadVS, ablateFS);
    if (!ablateProgram) {
        console.error('[ablation] Failed to compile ablate shader');
        return false;
    }

    setAblationTexture(ablationTex);

    return true;
}
export function ablateAt(x, y, z, radius = 4) {
    if (!ablateProgram || !ablationFBO) return;

    gl.bindFramebuffer(gl.FRAMEBUFFER, ablationFBO);
    gl.disable(gl.BLEND);
    gl.viewport(0, 0, aCompWidth, aCompHeight);
    gl.useProgram(ablateProgram);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, ablationTex);
    gl.uniform1i(gl.getUniformLocation(ablateProgram, 'iAblation'), 0);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, aFullTexelIndex);
    gl.uniform1i(gl.getUniformLocation(ablateProgram, 'fullTexelIndex'), 1);

    gl.uniform3i(gl.getUniformLocation(ablateProgram, 'ablateCenter'), x, y, z);
    gl.uniform1f(gl.getUniformLocation(ablateProgram, 'ablateRadius'), radius);
    gl.uniform1i(gl.getUniformLocation(ablateProgram, 'mx'), aMx);
    gl.uniform1i(gl.getUniformLocation(ablateProgram, 'my'), aMy);
    gl.uniform1i(gl.getUniformLocation(ablateProgram, 'fullWidth'), aFullWidth);
    gl.uniform1i(gl.getUniformLocation(ablateProgram, 'fullHeight'), aFullHeight);

    gl.bindVertexArray(ablationQuadVAO);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    _copyToMain();
}

function _copyToMain() {
    const tmp = ablationTex;
    ablationTex = ablationScratchTex;
    ablationScratchTex = tmp;

    gl.bindFramebuffer(gl.FRAMEBUFFER, ablationFBO);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, ablationScratchTex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

export function resetAblation() {
    if (!ablationTex || !ablationScratchTex) return;
    const zeros = new Float32Array(aCompWidth * aCompHeight * 4);
    gl.bindTexture(gl.TEXTURE_2D, ablationTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, aCompWidth, aCompHeight, gl.RGBA, gl.FLOAT, zeros);
    gl.bindTexture(gl.TEXTURE_2D, ablationScratchTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, aCompWidth, aCompHeight, gl.RGBA, gl.FLOAT, zeros);
}

export function getAblationTexture() {
    return ablationTex;
}
