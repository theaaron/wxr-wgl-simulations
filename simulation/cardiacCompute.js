// cardiac electrical simulation using GPU texture ping-pong
// based on the Minimal Model (Bueno-Orovio et al.)

// simulation state
let gl = null;
let initialized = false;

// texture dimensions (compressed domain)
let compWidth = 0;
let compHeight = 0;
let fullWidth = 0;
let fullHeight = 0;
let mx = 0, my = 0;

// ping-pong state textures (RGBA: U, V, W, D)
let fcolor0 = null;  // front buffer
let scolor0 = null;  // back buffer
let currentBuffer = 0;  // 0 = read from fcolor0, write to scolor0

// direction textures for neighbor lookup
let dir0 = null;  // NORTH, SOUTH, EAST, WEST (packed uint32)
let dir1 = null;  // UP, DOWN (packed uint32)

// texel index textures
let fullTexelIndex = null;
let compressedTexelIndex = null;

// FBOs for compute
let fbo0 = null;
let fbo1 = null;

// compute programs
let directionatorProgram = null;
let timeStepProgram = null;
let paceProgram = null;
let copyProgram = null;

// fullscreen quad for compute passes
let quadVAO = null;
let quadBuffer = null;

// simulation parameters (Minimal Model)
const params = {
    dt: 0.1,            // time step (ms) - matching original Abubu
    diffCoef: 0.001337, // diffusion coefficient (Patient 1-Alt value)
    lx: 12.0,           // domain size - scaled for 192 resolution (8 * 192/128 = 12)
    C_m: 1.0,           // membrane capacitance
    
    // Patient 1-Alt model parameters (from original Abubu)
    u_na: 0.23,         // fixed threshold
    u_c: 0.2171,
    u_v: 0.1142,
    u_w: 0.2508,
    u_d: 0.1428,
    u_m: 1.0,
    u_0: 0.0,
    u_so: 0.6520,
    x_tso: 2.161,
    x_k: 21.62,
    u_csi: 0.2168,
    
    t_d: 0.08673,
    t_soa: 54.90,
    t_sob: 1.685,
    t_o: 17.05,
    t_si: 38.82,
    t_vm: 46.77,
    t_vmm: 1321.0,
    t_vp: 1.759,
    t_wm: 80.18,
    t_wp: 749.5,
    t_sm: 1.983,
    t_sp: 1.484,
};

// running state
let running = false;
let stepsPerFrame = 20;  // matching original: skip=10 with 2 passes per iteration

// shader sources
const quadVS = `#version 300 es
in vec2 a_position;
out vec2 cc;
void main() {
    cc = a_position * 0.5 + 0.5;
    gl_Position = vec4(a_position, 0.0, 1.0);
}`;

const directionatorFS = `#version 300 es
precision highp float;
precision highp int;
precision highp usampler2D;

in vec2 cc;
uniform usampler2D fullTexelIndex;
uniform usampler2D compressedTexelIndex;
uniform int mx, my;

layout(location = 0) out uvec4 odir0;
layout(location = 1) out uvec4 odir1;

ivec3 getIdx(ivec2 texelPos, ivec3 size) {
    int I = texelPos.x;
    int J = texelPos.y;
    int i = I % size.x;
    int j = J % size.y;
    int k = (I / size.x) + (size.z / my - 1 - J / size.y) * mx;
    return ivec3(i, j, k);
}

ivec2 getIJ(ivec3 idx, ivec3 size) {
    int I = idx.x + (idx.z % mx) * size.x;
    int J = idx.y + (size.z / my - 1 - idx.z / mx) * size.y;
    return ivec2(I, J);
}

bool withinBounds(ivec3 v, ivec3 size) {
    return all(greaterThanEqual(v, ivec3(0))) && all(lessThan(v, size));
}

bool texelInDomain(ivec2 ij) {
    return texelFetch(compressedTexelIndex, ij, 0).a == uint(1);
}

bool inDomain(ivec3 v, ivec3 size) {
    if (!withinBounds(v, size)) return false;
    return texelInDomain(getIJ(v, size));
}

uint getPackedIndex(ivec3 checkPoint, ivec3 currentIdx, ivec3 size) {
    if (!inDomain(checkPoint, size)) {
        // zero-flux: return current texel
        ivec2 selfIJ = getIJ(currentIdx, size);
        uvec2 selfComp = texelFetch(compressedTexelIndex, selfIJ, 0).xy;
        // pack using bit shifting: high 16 bits = x, low 16 bits = y
        return (selfComp.x << 16u) | selfComp.y;
    }
    ivec2 targetIJ = getIJ(checkPoint, size);
    uvec2 compIdx = texelFetch(compressedTexelIndex, targetIJ, 0).xy;
    // pack using bit shifting: high 16 bits = x, low 16 bits = y
    return (compIdx.x << 16u) | compIdx.y;
}

void main() {
    ivec2 compSize = textureSize(fullTexelIndex, 0);
    ivec2 fullSize = textureSize(compressedTexelIndex, 0);
    ivec3 size = ivec3(fullSize.x / mx, fullSize.y / my, mx * my);
    
    ivec2 texelPos = ivec2(cc * vec2(compSize));
    uvec4 fullIdx = texelFetch(fullTexelIndex, texelPos, 0);
    
    if (fullIdx.a != uint(1)) {
        odir0 = uvec4(0u);
        odir1 = uvec4(0u);
        return;
    }
    
    ivec3 cidx = getIdx(ivec2(fullIdx.xy), size);
    ivec3 ii = ivec3(1, 0, 0);
    ivec3 jj = ivec3(0, 1, 0);
    ivec3 kk = ivec3(0, 0, 1);
    
    // pack neighbor indices
    odir0.r = getPackedIndex(cidx + jj, cidx, size);  // NORTH
    odir0.g = getPackedIndex(cidx - jj, cidx, size);  // SOUTH
    odir0.b = getPackedIndex(cidx + ii, cidx, size);  // EAST
    odir0.a = getPackedIndex(cidx - ii, cidx, size);  // WEST
    
    odir1.r = getPackedIndex(cidx + kk, cidx, size);  // UP
    odir1.g = getPackedIndex(cidx - kk, cidx, size);  // DOWN
    odir1.b = uint(0);
    odir1.a = uint(0);
}`;

const timeStepFS = `#version 300 es
precision highp float;
precision highp int;
precision highp usampler2D;

in vec2 cc;

uniform sampler2D icolor0;
uniform sampler2D vlt_txtr;
uniform usampler2D idir0;
uniform usampler2D idir1;

uniform float dt;
uniform float diffCoef;
uniform float lx;
uniform float C_m;
uniform int resolution;

// model parameters
uniform float u_na, u_v, u_w, u_d, u_c, u_m, u_0, u_so;
uniform float x_tso, x_k, u_csi;
uniform float t_d, t_soa, t_sob, t_o, t_si;
uniform float t_vm, t_vmm, t_vp, t_wm, t_wp, t_sm, t_sp;

layout(location = 0) out vec4 ocolor0;

#define U color0.r
#define V color0.g
#define W color0.b
#define D color0.a

#define vchannel r

#define NORTH dir0.r
#define SOUTH dir0.g
#define EAST  dir0.b
#define WEST  dir0.a
#define UP    dir1.r
#define DOWN  dir1.g

ivec2 unpack(uint packed) {
    // Original Abubu format: high 16 bits = x, low 16 bits = y
    return ivec2(int(packed >> 16u), int(packed & 65535u));
}

float Tanh(float x) {
    if (x < -3.0) return -1.0;
    if (x > 3.0) return 1.0;
    float x2 = x * x;
    return x * (27.0 + x2) / (27.0 + 9.0 * x2);
}

void main() {
    ivec2 isize = textureSize(icolor0, 0);
    ivec2 texelPos = ivec2(cc * vec2(isize));
    
    vec4 color0 = texelFetch(icolor0, texelPos, 0);
    
    // fetch direction channels
    uvec4 dir0 = texelFetch(idir0, texelPos, 0);
    uvec4 dir1 = texelFetch(idir1, texelPos, 0);
    
    // step functions
    float H_u_na = (U > u_na) ? 1.0 : 0.0;
    float H_u_v  = (U > u_v)  ? 1.0 : 0.0;
    float H_u_w  = (U > u_w)  ? 1.0 : 0.0;
    float H_u_d  = (U > u_d)  ? 1.0 : 0.0;
    float H_u_c  = (U > u_c)  ? 1.0 : 0.0;
    
    // I_fi (fast inward current)
    float I_fi = -V * (U - u_na) * (u_m - U) * H_u_na / t_d;
    
    // I_so (slow outward current)
    float t_so = t_soa + 0.5 * (t_sob - t_soa) * (1.0 + Tanh((U - u_so) * x_tso));
    float I_so = (U - u_0) * (1.0 - H_u_c) / t_o + H_u_c / t_so;
    
    // I_si (slow inward current)
    float I_si = -W * D / t_si;
    
    float I_sum = I_fi + I_so + I_si;
    
    // V gate
    float dV2dt = (1.0 - H_u_na) * (1.0 - V) / ((1.0 - H_u_v) * t_vm + H_u_v * t_vmm)
                - H_u_na * V / t_vp;
    V += dV2dt * dt;
    
    // W gate
    float dW2dt = (1.0 - H_u_w) * (1.0 - W) / t_wm - H_u_w * W / t_wp;
    W += dW2dt * dt;
    
    // D gate
    float dD2dt = ((1.0 - H_u_d) / t_sm + H_u_d / t_sp) *
                  ((1.0 + Tanh(x_k * (U - u_csi))) * 0.5 - D);
    D += dD2dt * dt;
    
    // Laplacian for diffusion
    float dx = lx / float(resolution);
    
    float laplacian = (
        texelFetch(vlt_txtr, unpack(NORTH), 0).vchannel +
        texelFetch(vlt_txtr, unpack(SOUTH), 0).vchannel +
        texelFetch(vlt_txtr, unpack(EAST), 0).vchannel +
        texelFetch(vlt_txtr, unpack(WEST), 0).vchannel +
        texelFetch(vlt_txtr, unpack(UP), 0).vchannel +
        texelFetch(vlt_txtr, unpack(DOWN), 0).vchannel -
        6.0 * texelFetch(vlt_txtr, texelPos, 0).vchannel
    );
    laplacian = laplacian / (dx * dx);
    
    // U (voltage)
    float dU2dt = laplacian * diffCoef - I_sum / C_m;
    U += dU2dt * dt;
    
    // clamp values
    U = clamp(U, 0.0, 1.0);
    V = clamp(V, 0.0, 1.0);
    W = clamp(W, 0.0, 1.0);
    D = clamp(D, 0.0, 1.0);
    
    ocolor0 = vec4(U, V, W, D);
}`;

const paceFS = `#version 300 es
precision highp float;
precision highp int;
precision highp usampler2D;

in vec2 cc;

uniform sampler2D icolor0;
uniform usampler2D fullTexelIndex;
uniform ivec3 paceCenter;
uniform float paceRadius;
uniform int mx, my;
uniform int fullWidth, fullHeight;

layout(location = 0) out vec4 ocolor0;

void main() {
    ivec2 isize = textureSize(icolor0, 0);
    ivec2 texelPos = ivec2(cc * vec2(isize));
    
    vec4 color0 = texelFetch(icolor0, texelPos, 0);
    
    // get full texture coords from fullTexelIndex (which is in compressed space)
    uvec4 fullIdx = texelFetch(fullTexelIndex, texelPos, 0);
    
    // fullIdx.xy contains the position in the full texture atlas
    // fullIdx.z = inDomain, fullIdx.w = valid
    if (fullIdx.w != uint(1)) {
        ocolor0 = color0;
        return;
    }
    
    // compute 3D voxel coordinates from full texture position
    int nx = fullWidth / mx;
    int ny = fullHeight / my;
    
    int texX = int(fullIdx.x);
    int texY = int(fullIdx.y);
    
    // which block (Z-slice row and column)
    int blockX = texX / nx;
    int blockY = texY / ny;
    
    // position within the block
    int x = texX % nx;
    int y = texY % ny;
    
    // Z coordinate from block position (blockY is flipped)
    int z = blockX + (my - 1 - blockY) * mx;
    
    float dist = length(vec3(x - paceCenter.x, y - paceCenter.y, z - paceCenter.z));
    
    if (dist < paceRadius) {
        color0.r = 1.0;  // set U = 1.0 (depolarized)
    }
    
    ocolor0 = color0;
}`;

const copyFS = `#version 300 es
precision highp float;

in vec2 cc;
uniform sampler2D source;
layout(location = 0) out vec4 ocolor;

void main() {
    ocolor = texture(source, cc);
}`;


export function initCardiacSimulation(glContext, structure) {
    gl = glContext;
    
    const meta = structure.metadata;
    compWidth = meta.compWidth;
    compHeight = meta.compHeight;
    fullWidth = meta.fullWidth;
    fullHeight = meta.fullHeight;
    mx = meta.mx;
    my = meta.my;
    
    console.log('Initializing cardiac simulation');
    
    // create fullscreen quad
    createQuad();
    
    // create textures
    createTextures(structure.raw);
    
    // compile shaders
    compilePrograms();
    
    // run directionator once
    runDirectionator();
    
    initialized = true;
    console.log('Cardiac simulation initialized');
    
    return true;
}

function createQuad() {
    const quadVertices = new Float32Array([
        -1, -1,
         1, -1,
        -1,  1,
         1,  1,
    ]);
    
    quadBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, quadVertices, gl.STATIC_DRAW);
    
    quadVAO = gl.createVertexArray();
    gl.bindVertexArray(quadVAO);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
}

function createTextures(rawData) {
    // state textures (RGBA float32)
    fcolor0 = createFloat32Texture(compWidth, compHeight);
    scolor0 = createFloat32Texture(compWidth, compHeight);
    
    // direction textures (RGBA uint32)
    dir0 = createUint32Texture(compWidth, compHeight);
    dir1 = createUint32Texture(compWidth, compHeight);
    
    // texel index textures from raw data
    fullTexelIndex = createUint32TextureWithData(
        compWidth, compHeight, 
        new Uint32Array(rawData.fullTexelIndex)
    );
    
    // build compressed texel index
    const compressedData = buildCompressedTexelIndex(rawData);
    compressedTexelIndex = createUint32TextureWithData(
        fullWidth, fullHeight,
        compressedData
    );
    
    // initialize state: U=0, V=1, W=1, D=0.03
    const initData = new Float32Array(compWidth * compHeight * 4);
    for (let i = 0; i < compWidth * compHeight; i++) {
        initData[i * 4 + 0] = 0.0;   // U
        initData[i * 4 + 1] = 1.0;   // V
        initData[i * 4 + 2] = 1.0;   // W
        initData[i * 4 + 3] = 0.03;  // D
    }
    
    gl.bindTexture(gl.TEXTURE_2D, fcolor0);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, compWidth, compHeight, gl.RGBA, gl.FLOAT, initData);
    gl.bindTexture(gl.TEXTURE_2D, scolor0);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, compWidth, compHeight, gl.RGBA, gl.FLOAT, initData);
    
    // create FBOs
    fbo0 = createFBO(scolor0);
    fbo1 = createFBO(fcolor0);
    
}

function buildCompressedTexelIndex(rawData) {
    const data = new Uint32Array(fullWidth * fullHeight * 4);
    const indices = rawData.fullTexelIndex;
    
    // fullTexelIndex format: [texX, texY, inDomain, valid] repeated
    for (let i = 0; i < indices.length; i += 4) {
        const texX = indices[i];
        const texY = indices[i + 1];
        const inDomain = indices[i + 2];
        const valid = indices[i + 3];
        
        if (valid === 1) {
            const fullIdx = texY * fullWidth + texX;
            const compIdx = i / 4;
            const compX = compIdx % compWidth;
            const compY = Math.floor(compIdx / compWidth);
            
            // store compressed coords at full position
            data[fullIdx * 4 + 0] = compX;
            data[fullIdx * 4 + 1] = compY;
            data[fullIdx * 4 + 2] = 1;  // in domain
            data[fullIdx * 4 + 3] = 1;  // valid
        }
    }
    
    return data;
}

function createFloat32Texture(width, height) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, width, height, 0, gl.RGBA, gl.FLOAT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    tex.width = width;
    tex.height = height;
    return tex;
}

function createUint32Texture(width, height) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32UI, width, height, 0, gl.RGBA_INTEGER, gl.UNSIGNED_INT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    tex.width = width;
    tex.height = height;
    return tex;
}

function createUint32TextureWithData(width, height, data) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32UI, width, height, 0, gl.RGBA_INTEGER, gl.UNSIGNED_INT, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    tex.width = width;
    tex.height = height;
    return tex;
}

let fboValid = false;

function createFBO(colorAttachment) {
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, colorAttachment, 0);
    
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
        console.error('FBO incomplete:', status, '- EXT_color_buffer_float may not be enabled');
        fboValid = false;
    } else {
        fboValid = true;
    }
    
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return fbo;
}

function compileShader(source, type) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error('Shader compile error:', gl.getShaderInfoLog(shader));
        return null;
    }
    return shader;
}

function createProgram(vsSource, fsSource) {
    const vs = compileShader(vsSource, gl.VERTEX_SHADER);
    const fs = compileShader(fsSource, gl.FRAGMENT_SHADER);
    if (!vs || !fs) return null;
    
    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        console.error('Program link error:', gl.getProgramInfoLog(program));
        return null;
    }
    return program;
}

function compilePrograms() {
    directionatorProgram = createProgram(quadVS, directionatorFS);
    timeStepProgram = createProgram(quadVS, timeStepFS);
    paceProgram = createProgram(quadVS, paceFS);
    copyProgram = createProgram(quadVS, copyFS);
    
    if (!directionatorProgram || !timeStepProgram || !paceProgram || !copyProgram) {
        console.error('Failed to compile cardiac simulation shaders');
        return false;
    }
    
    return true;
}

function runDirectionator() {
    // create FBO for direction textures (MRT)
    const dirFBO = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, dirFBO);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, dir0, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, dir1, 0);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
    
    gl.viewport(0, 0, compWidth, compHeight);
    gl.useProgram(directionatorProgram);
    
    // bind textures
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, fullTexelIndex);
    gl.uniform1i(gl.getUniformLocation(directionatorProgram, 'fullTexelIndex'), 0);
    
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, compressedTexelIndex);
    gl.uniform1i(gl.getUniformLocation(directionatorProgram, 'compressedTexelIndex'), 1);
    
    gl.uniform1i(gl.getUniformLocation(directionatorProgram, 'mx'), mx);
    gl.uniform1i(gl.getUniformLocation(directionatorProgram, 'my'), my);
    
    // draw
    gl.bindVertexArray(quadVAO);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
    
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(dirFBO);
}

function runTimeStep() {
    const readTex = currentBuffer === 0 ? fcolor0 : scolor0;
    const writeFBO = currentBuffer === 0 ? fbo0 : fbo1;
    
    gl.bindFramebuffer(gl.FRAMEBUFFER, writeFBO);
    gl.disable(gl.BLEND);  // CRITICAL: disable blending for compute shaders
    gl.viewport(0, 0, compWidth, compHeight);
    gl.useProgram(timeStepProgram);
    
    // bind textures
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, readTex);
    gl.uniform1i(gl.getUniformLocation(timeStepProgram, 'icolor0'), 0);
    gl.uniform1i(gl.getUniformLocation(timeStepProgram, 'vlt_txtr'), 0);
    
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, dir0);
    gl.uniform1i(gl.getUniformLocation(timeStepProgram, 'idir0'), 1);
    
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, dir1);
    gl.uniform1i(gl.getUniformLocation(timeStepProgram, 'idir1'), 2);
    
    // uniforms
    gl.uniform1f(gl.getUniformLocation(timeStepProgram, 'dt'), params.dt);
    gl.uniform1f(gl.getUniformLocation(timeStepProgram, 'diffCoef'), params.diffCoef);
    gl.uniform1f(gl.getUniformLocation(timeStepProgram, 'lx'), params.lx);
    gl.uniform1f(gl.getUniformLocation(timeStepProgram, 'C_m'), params.C_m);
    gl.uniform1i(gl.getUniformLocation(timeStepProgram, 'resolution'), fullWidth / mx);
    
    // model parameters
    gl.uniform1f(gl.getUniformLocation(timeStepProgram, 'u_na'), params.u_na);
    gl.uniform1f(gl.getUniformLocation(timeStepProgram, 'u_v'), params.u_v);
    gl.uniform1f(gl.getUniformLocation(timeStepProgram, 'u_w'), params.u_w);
    gl.uniform1f(gl.getUniformLocation(timeStepProgram, 'u_d'), params.u_d);
    gl.uniform1f(gl.getUniformLocation(timeStepProgram, 'u_c'), params.u_c);
    gl.uniform1f(gl.getUniformLocation(timeStepProgram, 'u_m'), params.u_m);
    gl.uniform1f(gl.getUniformLocation(timeStepProgram, 'u_0'), params.u_0);
    gl.uniform1f(gl.getUniformLocation(timeStepProgram, 'u_so'), params.u_so);
    gl.uniform1f(gl.getUniformLocation(timeStepProgram, 'x_tso'), params.x_tso);
    gl.uniform1f(gl.getUniformLocation(timeStepProgram, 'x_k'), params.x_k);
    gl.uniform1f(gl.getUniformLocation(timeStepProgram, 'u_csi'), params.u_csi);
    gl.uniform1f(gl.getUniformLocation(timeStepProgram, 't_d'), params.t_d);
    gl.uniform1f(gl.getUniformLocation(timeStepProgram, 't_soa'), params.t_soa);
    gl.uniform1f(gl.getUniformLocation(timeStepProgram, 't_sob'), params.t_sob);
    gl.uniform1f(gl.getUniformLocation(timeStepProgram, 't_o'), params.t_o);
    gl.uniform1f(gl.getUniformLocation(timeStepProgram, 't_si'), params.t_si);
    gl.uniform1f(gl.getUniformLocation(timeStepProgram, 't_vm'), params.t_vm);
    gl.uniform1f(gl.getUniformLocation(timeStepProgram, 't_vmm'), params.t_vmm);
    gl.uniform1f(gl.getUniformLocation(timeStepProgram, 't_vp'), params.t_vp);
    gl.uniform1f(gl.getUniformLocation(timeStepProgram, 't_wm'), params.t_wm);
    gl.uniform1f(gl.getUniformLocation(timeStepProgram, 't_wp'), params.t_wp);
    gl.uniform1f(gl.getUniformLocation(timeStepProgram, 't_sm'), params.t_sm);
    gl.uniform1f(gl.getUniformLocation(timeStepProgram, 't_sp'), params.t_sp);
    
    // draw
    gl.bindVertexArray(quadVAO);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
    
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    
    // swap buffers
    currentBuffer = 1 - currentBuffer;
}

let stepCount = 0;
export function stepSimulation(numSteps = 1) {
    if (!initialized || !fboValid) {
        return;
    }
    
    for (let i = 0; i < numSteps; i++) {
        runTimeStep();
        stepCount++;
    }
    
    
    // reset GL state after compute
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindVertexArray(null);
}

export function paceAt(x, y, z, radius = 5) {
    if (!initialized || !fboValid) return;
    
    const readTex = currentBuffer === 0 ? fcolor0 : scolor0;
    const writeFBO = currentBuffer === 0 ? fbo0 : fbo1;
    
    gl.bindFramebuffer(gl.FRAMEBUFFER, writeFBO);
    
    // CRITICAL: disable blending for compute shaders!
    gl.disable(gl.BLEND);
    
    // verify FBO is complete
    const fboStatus = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (fboStatus !== gl.FRAMEBUFFER_COMPLETE) {
        console.error('Pacing FBO not complete:', fboStatus);
        return;
    }
    
    gl.viewport(0, 0, compWidth, compHeight);
    gl.useProgram(paceProgram);
    
    // verify program is valid
    if (!gl.isProgram(paceProgram)) {
        console.error('paceProgram is not a valid program!');
        return;
    }
    
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, readTex);
    gl.uniform1i(gl.getUniformLocation(paceProgram, 'icolor0'), 0);
    
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, fullTexelIndex);
    gl.uniform1i(gl.getUniformLocation(paceProgram, 'fullTexelIndex'), 1);
    
    gl.uniform3i(gl.getUniformLocation(paceProgram, 'paceCenter'), x, y, z);
    gl.uniform1f(gl.getUniformLocation(paceProgram, 'paceRadius'), radius);
    gl.uniform1i(gl.getUniformLocation(paceProgram, 'mx'), mx);
    gl.uniform1i(gl.getUniformLocation(paceProgram, 'my'), my);
    gl.uniform1i(gl.getUniformLocation(paceProgram, 'fullWidth'), fullWidth);
    gl.uniform1i(gl.getUniformLocation(paceProgram, 'fullHeight'), fullHeight);
    
    gl.bindVertexArray(quadVAO);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
    
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    currentBuffer = 1 - currentBuffer;
    
    console.log(`Paced at (${x}, ${y}, ${z}) with radius ${radius}`);
}

export function getVoltageTexture() {
    return currentBuffer === 0 ? fcolor0 : scolor0;
}

export function isRunning() {
    return running;
}

export function setRunning(state) {
    running = state;
}

export function setStepsPerFrame(steps) {
    stepsPerFrame = steps;
}

export function getStepsPerFrame() {
    return stepsPerFrame;
}

export function getParams() {
    return params;
}

export function isInitialized() {
    return initialized;
}

export function isSimulationWorking() {
    return initialized && fboValid;
}

// for reading voltage back to CPU (for coloring voxels)
export function readVoltageData() {
    if (!initialized || !fboValid) return null;
    
    const readTex = currentBuffer === 0 ? fcolor0 : scolor0;
    
    // create temp FBO to read from
    const readFBO = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, readFBO);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, readTex, 0);
    
    const data = new Float32Array(compWidth * compHeight * 4);
    gl.readPixels(0, 0, compWidth, compHeight, gl.RGBA, gl.FLOAT, data);
    
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(readFBO);
    
    return data;
}

export function getCompressedDimensions() {
    return { width: compWidth, height: compHeight };
}
