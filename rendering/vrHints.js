// ============================================================================
// VR HINTS — floating billboard cards that guide new users
// Panel hint: "Pinch to grab & move" (dismissed when panel is first grabbed)
// Structure hint: "Pinch both hands to scale" (dismissed when both hands pinch)
// ============================================================================

const DELAY_S    = 2.0;
const FADE_IN_S  = 1.0;
const FADE_OUT_S = 0.5;

// ============================================================================
// SHADERS
// ============================================================================

const HINT_BG_VS = `#version 300 es
in vec3 a_position;
uniform mat4 u_projectionMatrix;
uniform mat4 u_viewMatrix;
uniform mat4 u_modelMatrix;
uniform vec2 u_size;
void main() {
    vec4 localPos = vec4(a_position.x * u_size.x, a_position.y * u_size.y, 0.0, 1.0);
    gl_Position = u_projectionMatrix * u_viewMatrix * u_modelMatrix * localPos;
}`;

const HINT_BG_FS = `#version 300 es
precision mediump float;
uniform vec4 u_bgColor;
uniform float u_alpha;
out vec4 fragColor;
void main() {
    fragColor = vec4(u_bgColor.rgb, u_bgColor.a * u_alpha);
}`;

const HINT_TEXT_VS = `#version 300 es
in vec3 a_position;
uniform mat4 u_projectionMatrix;
uniform mat4 u_viewMatrix;
uniform mat4 u_modelMatrix;
uniform vec2 u_size;
out vec2 v_uv;
void main() {
    v_uv = vec2(a_position.x + 0.5, 0.5 - a_position.y);
    vec4 localPos = vec4(a_position.x * u_size.x * 0.90,
                         a_position.y * u_size.y * 0.75,
                         0.001,
                         1.0);
    gl_Position = u_projectionMatrix * u_viewMatrix * u_modelMatrix * localPos;
}`;

const HINT_TEXT_FS = `#version 300 es
precision mediump float;
uniform sampler2D u_texture;
uniform float u_alpha;
in vec2 v_uv;
out vec4 fragColor;
void main() {
    vec4 c = texture(u_texture, v_uv);
    if (c.a < 0.05) discard;
    fragColor = vec4(c.rgb, c.a * u_alpha);
}`;

// ============================================================================
// MODULE STATE
// ============================================================================

let gl        = null;
let bgProg    = null;
let textProg  = null;
let quadVBO   = null;
let quadIBO   = null;

let panelHintTex  = null;
let structHintTex = null;
let hintsEnabled  = true;

let panelHint  = null;
let structHint = null;

// ============================================================================
// HELPERS
// ============================================================================

function compileShader(src, type, name) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
        console.error(`vrHints ${name}:`, gl.getShaderInfoLog(s));
    return s;
}

function linkProgram(vs, fs, name) {
    const p = gl.createProgram();
    gl.attachShader(p, compileShader(vs, gl.VERTEX_SHADER,   name + '_VS'));
    gl.attachShader(p, compileShader(fs, gl.FRAGMENT_SHADER, name + '_FS'));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS))
        console.error(`vrHints ${name} link:`, gl.getProgramInfoLog(p));
    return p;
}

function createHintTextTexture(text) {
    const W = 512, H = 128;
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = 'white';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    let fontSize = Math.floor(H * 0.44);
    ctx.font = `bold ${fontSize}px sans-serif`;
    while (ctx.measureText(text).width > W * 0.92 && fontSize > 8) {
        fontSize -= 2;
        ctx.font = `bold ${fontSize}px sans-serif`;
    }
    ctx.fillText(text, W / 2, H / 2);
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindTexture(gl.TEXTURE_2D, null);
    return tex;
}

function makeHint(getTex) {
    return { state: 'HIDDEN', timer: 0, alpha: 0, getTex };
}

function advanceHint(hint, dt, dismissed) {
    switch (hint.state) {
        case 'HIDDEN':
            hint.timer = 0;
            hint.state = 'DELAY';
            break;
        case 'DELAY':
            hint.timer += dt;
            if (hint.timer >= DELAY_S) { hint.timer = 0; hint.state = 'FADE_IN'; }
            break;
        case 'FADE_IN':
            hint.timer += dt;
            hint.alpha = Math.min(hint.timer / FADE_IN_S, 1.0);
            if (dismissed)         { hint.timer = 0; hint.state = 'FADE_OUT'; }
            else if (hint.alpha >= 1.0) { hint.state = 'VISIBLE'; }
            break;
        case 'VISIBLE':
            hint.alpha = 1.0;
            if (dismissed) { hint.timer = 0; hint.state = 'FADE_OUT'; }
            break;
        case 'FADE_OUT':
            hint.timer += dt;
            hint.alpha = Math.max(1.0 - hint.timer / FADE_OUT_S, 0.0);
            if (hint.alpha <= 0.0) hint.state = 'DONE';
            break;
        case 'DONE':
            hint.alpha = 0.0;
            break;
    }
}

// Billboard matrix: card always faces the camera.
// V is the XR view matrix (column-major). Its columns are camera axes in world space.
function makeBillboardMatrix(V, worldPos) {
    return new Float32Array([
         V[0],  V[1],  V[2], 0,   // camera right
         V[4],  V[5],  V[6], 0,   // camera up
        -V[8], -V[9], -V[10], 0,  // toward camera (negate cam back = cam forward)
        worldPos[0], worldPos[1], worldPos[2], 1,
    ]);
}

// Transform panel-local point to world using the panel model matrix.
function panelLocalToWorld(M, lx, ly, lz) {
    return [
        M[0]*lx + M[4]*ly + M[8]*lz  + M[12],
        M[1]*lx + M[5]*ly + M[9]*lz  + M[13],
        M[2]*lx + M[6]*ly + M[10]*lz + M[14],
    ];
}

function renderOneHint(hint, bbMat, proj, view, cardW, cardH) {
    // Background quad
    gl.useProgram(bgProg);
    const posLoc = gl.getAttribLocation(bgProg, 'a_position');
    gl.bindBuffer(gl.ARRAY_BUFFER, quadVBO);
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, quadIBO);
    gl.uniformMatrix4fv(gl.getUniformLocation(bgProg, 'u_projectionMatrix'), false, proj);
    gl.uniformMatrix4fv(gl.getUniformLocation(bgProg, 'u_viewMatrix'),       false, view);
    gl.uniformMatrix4fv(gl.getUniformLocation(bgProg, 'u_modelMatrix'),      false, bbMat);
    gl.uniform2fv(gl.getUniformLocation(bgProg, 'u_size'),    [cardW, cardH]);
    gl.uniform4fv(gl.getUniformLocation(bgProg, 'u_bgColor'), [0.0, 0.05, 0.22, 0.85]);
    gl.uniform1f(gl.getUniformLocation(bgProg, 'u_alpha'),    hint.alpha);
    gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);

    // Text quad (z+0.001 in VS keeps it in front of the bg)
    gl.useProgram(textProg);
    const posLoc2 = gl.getAttribLocation(textProg, 'a_position');
    gl.bindBuffer(gl.ARRAY_BUFFER, quadVBO);
    gl.enableVertexAttribArray(posLoc2);
    gl.vertexAttribPointer(posLoc2, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, quadIBO);
    gl.uniformMatrix4fv(gl.getUniformLocation(textProg, 'u_projectionMatrix'), false, proj);
    gl.uniformMatrix4fv(gl.getUniformLocation(textProg, 'u_viewMatrix'),       false, view);
    gl.uniformMatrix4fv(gl.getUniformLocation(textProg, 'u_modelMatrix'),      false, bbMat);
    gl.uniform2fv(gl.getUniformLocation(textProg, 'u_size'),    [cardW, cardH]);
    gl.uniform1f(gl.getUniformLocation(textProg, 'u_alpha'),    hint.alpha);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, hint.getTex());
    gl.uniform1i(gl.getUniformLocation(textProg, 'u_texture'), 0);
    gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
    gl.bindTexture(gl.TEXTURE_2D, null);
}

// ============================================================================
// PUBLIC API
// ============================================================================

export function setHintsEnabled(enabled) {
    hintsEnabled = enabled;
    if (!enabled) {
        for (const hint of [panelHint, structHint]) {
            if (hint && hint.state !== 'DONE') {
                hint.timer = 0;
                hint.state = 'FADE_OUT';
            }
        }
    } else {
        for (const hint of [panelHint, structHint]) {
            if (hint) { hint.timer = 0; hint.state = 'FADE_IN'; hint.alpha = 0; }
        }
    }
}

export function areHintsEnabled() { return hintsEnabled; }

export function initVRHints(glContext) {
    gl = glContext;

    const verts   = new Float32Array([-0.5,-0.5,0,  0.5,-0.5,0,  0.5,0.5,0,  -0.5,0.5,0]);
    const indices = new Uint16Array([0,1,2, 0,2,3]);

    quadVBO = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quadVBO);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);

    quadIBO = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, quadIBO);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);

    bgProg   = linkProgram(HINT_BG_VS,   HINT_BG_FS,   'HintBG');
    textProg = linkProgram(HINT_TEXT_VS, HINT_TEXT_FS, 'HintText');

    panelHintTex  = createHintTextTexture('Pinch to grab & move');
    structHintTex = createHintTextTexture('Pinch both hands to scale');

    panelHint  = makeHint(() => panelHintTex);
    structHint = makeHint(() => structHintTex);
}

export function updateVRHints(dt, panelGrabbed, bothPinching) {
    if (!panelHint) return;
    if (!hintsEnabled && (panelHint.state === 'HIDDEN' || panelHint.state === 'DONE')) return;
    advanceHint(panelHint,  dt, panelGrabbed);
    advanceHint(structHint, dt, bothPinching);
}

export function renderVRHints(projectionMatrix, viewMatrix,
                               panelModelMatrix, structModelMatrix,
                               surfBoundsCenter) {
    if (!bgProg || !textProg || !quadVBO) return;

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(false);

    // Panel hint — floats below the grab bar (grab bar is at panel local y=-0.46)
    if (panelHint && panelHint.alpha > 0.001 && panelModelMatrix) {
        const wpos = panelLocalToWorld(panelModelMatrix, 0.0, -0.64, 0.0);
        const bbMat = makeBillboardMatrix(viewMatrix, wpos);
        renderOneHint(panelHint, bbMat, projectionMatrix, viewMatrix, 0.22, 0.07);
    }

    // Structure hint — floats above the structure's bounding sphere
    if (structHint && structHint.alpha > 0.001 && structModelMatrix) {
        const M = structModelMatrix;
        const [bx, by, bz] = surfBoundsCenter;
        // Transform bounds center to world space
        const wx = M[0]*bx + M[4]*by + M[8]*bz  + M[12];
        const wy = M[1]*bx + M[5]*by + M[9]*bz  + M[13];
        const wz = M[2]*bx + M[6]*by + M[10]*bz + M[14];
        // Estimate visual radius from scale column magnitude, push hint above it
        const scale = Math.sqrt(M[0]*M[0] + M[1]*M[1] + M[2]*M[2]);
        const wpos = [wx, wy + scale + 0.10, wz];
        const bbMat = makeBillboardMatrix(viewMatrix, wpos);
        renderOneHint(structHint, bbMat, projectionMatrix, viewMatrix, 0.28, 0.07);
    }

    gl.depthMask(true);
    gl.disable(gl.BLEND);
}
