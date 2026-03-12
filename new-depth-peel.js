
import { loadStructure } from './rendering/loadStructure.js';
import { loadLabModel, renderLab, isLabLoaded } from './rendering/renderLab.js';
import {
    initVRControllers, setupControllerInput, updateControllers,
    getStructureModelMatrix, updateStructureManipulation,
    setPaceCallback, getLeftController, getRightController,
    renderControllerRays
} from './rendering/vrControllers.js';
import {
    initVRPanel, setPanelCallbacks, renderVRPanel, updatePanelHover
} from './rendering/vrPanel.js';
import { fetchWithProgress } from './loadingProgress.js';

// ============================================================================
// RENDERING SHADERS
// ============================================================================

const PEEL_VS = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;

uniform int         u_noVoxels;
uniform float       u_voxelSize;
uniform float       u_alpha;

uniform sampler2D   u_posTex;       // RGBA32F: xyz = pos(0-1), w = flag
uniform sampler2D   u_normalTex;    // RGBA32F: xyz = surface normal

// simulation coloring
uniform sampler2D   u_voltageTex;   // RGBA32F: r = U (voltage 0-1)
uniform int         u_compWidth;    // width of compressed sim texture
uniform bool        u_useSimTex;    // whether sim is active

uniform mat4        u_projectionMatrix;
uniform mat4        u_viewMatrix;
uniform mat4        u_modelMatrix;
uniform mat4        u_normalMatrix;

uniform vec4        u_lightColor;
uniform float       u_lightAmbientTerm;
uniform float       u_lightSpecularTerm;
uniform vec3        u_lightDirection;
uniform vec4        u_materialColor;
uniform float       u_materialAmbientTerm;
uniform float       u_materialSpecularTerm;
uniform float       u_shininess;

out vec4  v_color;
out float v_shade;

// Jet colormap: blue=0 -> cyan -> green -> yellow -> red=1
vec3 jetColor(float t) {
    t = clamp(t, 0.0, 1.0);
    float r = clamp(1.5 - abs(4.0 * t - 3.0), 0.0, 1.0);
    float g = clamp(1.5 - abs(4.0 * t - 2.0), 0.0, 1.0);
    float b = clamp(1.5 - abs(4.0 * t - 1.0), 0.0, 1.0);
    return vec3(r, g, b);
}

void main() {
    // cube vertex table identical to Abubu vpeeling
    vec3 cv[36];
    cv[0] =vec3(0,0,1);cv[1] =vec3(1,0,1);cv[2] =vec3(0,1,1);
    cv[3] =vec3(0,1,1);cv[4] =vec3(1,0,1);cv[5] =vec3(1,1,1);
    cv[6] =vec3(1,1,1);cv[7] =vec3(1,0,1);cv[8] =vec3(1,1,0);
    cv[9] =vec3(1,1,0);cv[10]=vec3(1,0,1);cv[11]=vec3(1,0,0);
    cv[12]=vec3(1,0,0);cv[13]=vec3(1,0,1);cv[14]=vec3(0,0,0);
    cv[15]=vec3(0,0,0);cv[16]=vec3(1,0,1);cv[17]=vec3(0,0,1);
    cv[18]=vec3(0,0,1);cv[19]=vec3(0,1,1);cv[20]=vec3(0,0,0);
    cv[21]=vec3(0,0,0);cv[22]=vec3(0,1,1);cv[23]=vec3(0,1,0);
    cv[24]=vec3(0,1,0);cv[25]=vec3(0,1,1);cv[26]=vec3(1,1,1);
    cv[27]=vec3(1,1,1);cv[28]=vec3(1,1,0);cv[29]=vec3(0,1,0);
    cv[30]=vec3(0,1,0);cv[31]=vec3(1,1,0);cv[32]=vec3(0,0,0);
    cv[33]=vec3(0,0,0);cv[34]=vec3(1,1,0);cv[35]=vec3(1,0,0);

    int vertId  = gl_VertexID % 36;
    int voxelId = gl_VertexID / 36;

    ivec2 texSize  = textureSize(u_posTex, 0);
    ivec2 tc       = ivec2(voxelId % texSize.x, voxelId / texSize.x);
    vec4  pos4     = texelFetch(u_posTex, tc, 0);
    v_shade        = (pos4.a > 0.5) ? 1.0 : 0.0;

    vec3 pos = (pos4.xyz - 0.5) * 2.0;
    pos += u_voxelSize * 0.005 * 2.0 * (cv[vertId] - 0.5);

    vec3 surfNormal = texelFetch(u_normalTex, tc, 0).xyz;
    float nLen = length(surfNormal);
    if (nLen < 0.01) v_shade = 0.0;

    vec3 N = (nLen > 0.01) ? normalize(mat3(u_normalMatrix) * surfNormal) : vec3(0,1,0);
    vec3 E = normalize(-(u_viewMatrix * u_modelMatrix * vec4(pos, 1.0)).xyz);
    vec3 L = normalize(u_lightDirection);
    vec3 R = reflect(L, N);
    float lambert = dot(N, -L);

    // choose material color: voltage colormap or default gray
    vec4 mColor = u_materialColor;
    if (u_useSimTex && u_compWidth > 0) {
        ivec2 simTC = ivec2(voxelId % u_compWidth, voxelId / u_compWidth);
        float voltage = texelFetch(u_voltageTex, simTC, 0).r;
        if (voltage > 0.05) {
            mColor = vec4(jetColor(voltage), 1.0);
        }
    }

    vec4 Ia = vec4(vec3(u_lightAmbientTerm * u_materialAmbientTerm), 1.0);
    vec4 Id = vec4(0.0);
    vec4 Is = vec4(0.0);
    if (lambert > 0.0) {
        Id = u_lightColor * mColor * lambert;
        float spec = pow(max(dot(R, E), 0.0), u_shininess);
        Is = vec4(vec3(u_lightSpecularTerm * u_materialSpecularTerm * spec), 1.0);
    }

    v_color = vec4(vec3(Ia + Id + Is), u_alpha);
    gl_Position = u_projectionMatrix * u_viewMatrix * u_modelMatrix * vec4(pos, 1.0);
}
`;

const PEEL_FS = `#version 300 es
precision highp float;
in vec4  v_color;
in float v_shade;
out vec4 fragColor;
void main() {
    if (v_shade < 0.5) discard;
    fragColor = v_color;
}
`;

// ============================================================================
// SIMULATION SHADERS (inlined from cardiacCompute.js)
// ============================================================================

const QUAD_VS = `#version 300 es
layout(location=0) in vec2 a_position;
out vec2 cc;
void main() {
    cc = a_position * 0.5 + 0.5;
    gl_Position = vec4(a_position, 0.0, 1.0);
}`;

const DIRECTIONATOR_FS = `#version 300 es
precision highp float;
precision highp int;
precision highp usampler2D;
in vec2 cc;
uniform usampler2D fullTexelIndex;
uniform usampler2D compressedTexelIndex;
uniform int mx, my;
layout(location=0) out uvec4 odir0;
layout(location=1) out uvec4 odir1;

ivec3 getIdx(ivec2 p, ivec3 sz) {
    return ivec3(p.x % sz.x, p.y % sz.y,
        (p.x / sz.x) + (my - 1 - p.y / sz.y) * mx);
}
ivec2 getIJ(ivec3 idx, ivec3 sz) {
    return ivec2(idx.x + (idx.z % mx) * sz.x,
                 idx.y + (my - 1 - idx.z / mx) * sz.y);
}
bool inBounds(ivec3 v, ivec3 sz) {
    return all(greaterThanEqual(v,ivec3(0))) && all(lessThan(v,sz));
}
bool inDomain(ivec3 v, ivec3 sz) {
    if (!inBounds(v,sz)) return false;
    return texelFetch(compressedTexelIndex, getIJ(v,sz), 0).a == uint(1);
}
uint packNeighbor(ivec3 c, ivec3 d, ivec3 sz) {
    ivec3 nb = c + d;
    if (!inDomain(nb, sz)) nb = c;
    uvec2 ci = texelFetch(compressedTexelIndex, getIJ(nb,sz), 0).xy;
    return (ci.x << 16u) | ci.y;
}
void main() {
    ivec2 compSz = textureSize(fullTexelIndex, 0);
    ivec2 fullSz = textureSize(compressedTexelIndex, 0);
    ivec3 sz = ivec3(fullSz.x / mx, fullSz.y / my, mx * my);
    ivec2 tp = ivec2(cc * vec2(compSz));
    uvec4 fi = texelFetch(fullTexelIndex, tp, 0);
    if (fi.a != uint(1)) { odir0 = uvec4(0u); odir1 = uvec4(0u); return; }
    ivec3 c = getIdx(ivec2(fi.xy), sz);
    odir0.r = packNeighbor(c, ivec3(0,1,0), sz);
    odir0.g = packNeighbor(c, ivec3(0,-1,0), sz);
    odir0.b = packNeighbor(c, ivec3(1,0,0), sz);
    odir0.a = packNeighbor(c, ivec3(-1,0,0), sz);
    odir1.r = packNeighbor(c, ivec3(0,0,1), sz);
    odir1.g = packNeighbor(c, ivec3(0,0,-1), sz);
    odir1.b = uint(0); odir1.a = uint(0);
}`;

const TIMESTEP_FS = `#version 300 es
precision highp float;
precision highp int;
precision highp usampler2D;
in vec2 cc;
uniform sampler2D  icolor0;
uniform usampler2D idir0, idir1;
uniform float dt, diffCoef, lx, C_m;
uniform int resolution;
uniform float u_na,u_v,u_w,u_d,u_c,u_m,u_0,u_so,x_tso,x_k,u_csi;
uniform float t_d,t_soa,t_sob,t_o,t_si,t_vm,t_vmm,t_vp,t_wm,t_wp,t_sm,t_sp;
layout(location=0) out vec4 ocolor0;
ivec2 unpack(uint p) { return ivec2(int(p>>16u), int(p&65535u)); }
float Tanh(float x) {
    if(x<-3.)return -1.; if(x>3.)return 1.;
    return x*(27.+x*x)/(27.+9.*x*x);
}
void main() {
    ivec2 sz = textureSize(icolor0,0);
    ivec2 tp = ivec2(cc*vec2(sz));
    vec4 c0 = texelFetch(icolor0,tp,0);
    float U=c0.r, V=c0.g, W=c0.b, D=c0.a;
    uvec4 d0=texelFetch(idir0,tp,0), d1=texelFetch(idir1,tp,0);
    float Hna=(U>u_na)?1.:0., Hv=(U>u_v)?1.:0., Hw=(U>u_w)?1.:0.;
    float Hd=(U>u_d)?1.:0., Hc=(U>u_c)?1.:0.;
    float t_so=t_soa+.5*(t_sob-t_soa)*(1.+Tanh((U-u_so)*x_tso));
    float Ifi=-V*(U-u_na)*(u_m-U)*Hna/t_d;
    float Iso=(U-u_0)*(1.-Hc)/t_o+Hc/t_so;
    float Isi=-W*D/t_si;
    float Isum=Ifi+Iso+Isi;
    V+=((1.-Hna)*(1.-V)/((1.-Hv)*t_vm+Hv*t_vmm)-Hna*V/t_vp)*dt;
    W+=((1.-Hw)*(1.-W)/t_wm-Hw*W/t_wp)*dt;
    D+=(((1.-Hd)/t_sm+Hd/t_sp)*((1.+Tanh(x_k*(U-u_csi)))*.5-D))*dt;
    float dx=lx/float(resolution);
    float lap=(
        texelFetch(icolor0,unpack(d0.r),0).r+
        texelFetch(icolor0,unpack(d0.g),0).r+
        texelFetch(icolor0,unpack(d0.b),0).r+
        texelFetch(icolor0,unpack(d0.a),0).r+
        texelFetch(icolor0,unpack(d1.r),0).r+
        texelFetch(icolor0,unpack(d1.g),0).r-
        6.*U)/(dx*dx);
    U=clamp(U+(lap*diffCoef-Isum/C_m)*dt,0.,1.);
    ocolor0=vec4(U,clamp(V,0.,1.),clamp(W,0.,1.),clamp(D,0.,1.));
}`;

const PACE_FS = `#version 300 es
precision highp float;
precision highp int;
precision highp usampler2D;
in vec2 cc;
uniform sampler2D  icolor0;
uniform usampler2D fullTexelIndex;
uniform ivec3 paceCenter;
uniform float paceRadius;
uniform int mx, my, fullWidth, fullHeight;
layout(location=0) out vec4 ocolor0;
void main() {
    ivec2 sz=textureSize(icolor0,0);
    ivec2 tp=ivec2(cc*vec2(sz));
    vec4 c0=texelFetch(icolor0,tp,0);
    uvec4 fi=texelFetch(fullTexelIndex,tp,0);
    if(fi.a!=uint(1)){ocolor0=c0;return;}
    int nx=fullWidth/mx, ny=fullHeight/my;
    int tx=int(fi.x), ty=int(fi.y);
    int bx=tx/nx, by=ty/ny;
    int x=tx%nx, y=ty%ny, z=bx+(my-1-by)*mx;
    float dist=length(vec3(x-paceCenter.x,y-paceCenter.y,z-paceCenter.z));
    if(dist<paceRadius) c0.r=1.0;
    ocolor0=c0;
}`;

// ============================================================================
// UTILITIES
// ============================================================================
function compile(gl, src, type, name) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        console.error(`Shader (${name}):`, gl.getShaderInfoLog(s));
        return null;
    }
    return s;
}
function mkProgram(gl, vs, fs, name) {
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl, vs, gl.VERTEX_SHADER, name + ' VS'));
    gl.attachShader(p, compile(gl, fs, gl.FRAGMENT_SHADER, name + ' FS'));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
        console.error(`Link (${name}):`, gl.getProgramInfoLog(p));
        return null;
    }
    return p;
}

const mat4u = {
    create() { const o = new Float32Array(16); o[0] = o[5] = o[10] = o[15] = 1; return o; },
    perspective(o, fovy, aspect, near, far) {
        const f = 1 / Math.tan(fovy / 2);
        o[0] = f / aspect; o[1] = o[2] = o[3] = 0; o[4] = 0; o[5] = f; o[6] = o[7] = 0;
        o[8] = o[9] = 0; o[10] = (far + near) / (near - far); o[11] = -1;
        o[12] = o[13] = 0; o[14] = (2 * far * near) / (near - far); o[15] = 0; return o;
    },
    lookAt(o, eye, ctr, up) {
        const zx = eye[0] - ctr[0], zy = eye[1] - ctr[1], zz = eye[2] - ctr[2];
        let l = Math.sqrt(zx * zx + zy * zy + zz * zz);
        const z = [zx / l, zy / l, zz / l];
        const xx = up[1] * z[2] - up[2] * z[1], xy = up[2] * z[0] - up[0] * z[2], xz = up[0] * z[1] - up[1] * z[0];
        l = Math.sqrt(xx * xx + xy * xy + xz * xz);
        const x = [xx / l, xy / l, xz / l];
        const y = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]];
        o[0] = x[0]; o[1] = y[0]; o[2] = z[0]; o[3] = 0;
        o[4] = x[1]; o[5] = y[1]; o[6] = z[1]; o[7] = 0;
        o[8] = x[2]; o[9] = y[2]; o[10] = z[2]; o[11] = 0;
        o[12] = -(x[0] * eye[0] + x[1] * eye[1] + x[2] * eye[2]);
        o[13] = -(y[0] * eye[0] + y[1] * eye[1] + y[2] * eye[2]);
        o[14] = -(z[0] * eye[0] + z[1] * eye[1] + z[2] * eye[2]);
        o[15] = 1; return o;
    },
};

function mul4(a, b) {
    const o = new Float32Array(16);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++)
        o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    return o;
}

function normalMat(m) {
    const o = new Float32Array(16);
    const m00 = m[0], m01 = m[1], m02 = m[2], m03 = m[3], m10 = m[4], m11 = m[5], m12 = m[6], m13 = m[7];
    const m20 = m[8], m21 = m[9], m22 = m[10], m23 = m[11], m30 = m[12], m31 = m[13], m32 = m[14], m33 = m[15];
    const b00 = m00 * m11 - m01 * m10, b01 = m00 * m12 - m02 * m10, b02 = m00 * m13 - m03 * m10;
    const b03 = m01 * m12 - m02 * m11, b04 = m01 * m13 - m03 * m11, b05 = m02 * m13 - m03 * m12;
    const b06 = m20 * m31 - m21 * m30, b07 = m20 * m32 - m22 * m30, b08 = m20 * m33 - m23 * m30;
    const b09 = m21 * m32 - m22 * m31, b10 = m21 * m33 - m23 * m31, b11 = m22 * m33 - m23 * m32;
    let d = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
    if (!d) return o; d = 1 / d;
    o[0] = (m11 * b11 - m12 * b10 + m13 * b09) * d; o[1] = (m02 * b10 - m01 * b11 - m03 * b09) * d;
    o[2] = (m31 * b05 - m32 * b04 + m33 * b03) * d; o[3] = (m22 * b04 - m21 * b05 - m23 * b03) * d;
    o[4] = (m12 * b08 - m10 * b11 - m13 * b07) * d; o[5] = (m00 * b11 - m02 * b08 + m03 * b07) * d;
    o[6] = (m32 * b02 - m30 * b05 - m33 * b01) * d; o[7] = (m20 * b05 - m22 * b02 + m23 * b01) * d;
    o[8] = (m10 * b10 - m11 * b08 + m13 * b06) * d; o[9] = (m01 * b08 - m00 * b10 - m03 * b06) * d;
    o[10] = (m30 * b04 - m31 * b02 + m33 * b00) * d; o[11] = (m21 * b02 - m20 * b04 - m23 * b00) * d;
    o[12] = (m11 * b07 - m10 * b09 - m12 * b06) * d; o[13] = (m00 * b09 - m01 * b07 + m02 * b06) * d;
    o[14] = (m31 * b01 - m30 * b03 - m32 * b00) * d; o[15] = (m20 * b03 - m21 * b01 + m22 * b00) * d;
    let t;
    t = o[1]; o[1] = o[4]; o[4] = t; t = o[2]; o[2] = o[8]; o[8] = t;
    t = o[3]; o[3] = o[12]; o[12] = t; t = o[6]; o[6] = o[9]; o[9] = t;
    t = o[7]; o[7] = o[13]; o[13] = t; t = o[11]; o[11] = o[14]; o[14] = t;
    return o;
}

// ============================================================================
// GLOBALS
// ============================================================================
let gl = null;
let xrSession = null;
let xrReferenceSpace = null;
let peelProg = null;
let structure = null;

let posTex = null;
let normalTex = null;
let numVoxels = 0;
let texWidth = 0;
let texHeight = 0;

let VOXEL_SIZE = 5.0;
const ALPHA = 0.8;
const LIGHT_DIR = [-0.19, -0.21, -0.66];

let labModelMatrix = null;

// ============================================================================
// SIMULATION STATE (inlined)
// ============================================================================
let simInitialized = false;
let simRunning = false;
let stepsPerFrame = 20;

let compWidth = 0, compHeight = 0, fullWidth = 0, fullHeight = 0, mx = 0, my = 0;
let fcolor0 = null, scolor0 = null, fbo0 = null, fbo1 = null;
let dir0 = null, dir1 = null;
let fullTexelIndex = null, compressedTexelIndex = null;
let currentBuffer = 0;
let quadBuffer = null, quadVAO = null;
let dirProgram = null, stepProgram = null, paceProgram = null;

const simParams = {
    dt: 0.1, diffCoef: 0.001337, C_m: 1.0,
    u_na: 0.23, u_c: 0.2171, u_v: 0.1142, u_w: 0.2508, u_d: 0.1428,
    u_m: 1.0, u_0: 0.0, u_so: 0.6520, x_tso: 2.161, x_k: 21.62, u_csi: 0.2168,
    t_d: 0.08673, t_soa: 54.90, t_sob: 1.685, t_o: 17.05, t_si: 38.82,
    t_vm: 46.77, t_vmm: 1321.0, t_vp: 1.759,
    t_wm: 80.18, t_wp: 749.5, t_sm: 1.983, t_sp: 1.484,
};

function mkF32Tex(w, h) {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, w, h, 0, gl.RGBA, gl.FLOAT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
}
function mkU32Tex(w, h, data = null) {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32UI, w, h, 0, gl.RGBA_INTEGER, gl.UNSIGNED_INT, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
}
function mkFBO(tex) {
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE)
        console.error('FBO incomplete');
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return fbo;
}

function buildCompressedTexelIndex(raw) {
    const data = new Uint32Array(fullWidth * fullHeight * 4);
    const idx = raw.fullTexelIndex;
    for (let i = 0; i < idx.length; i += 4) {
        const tx = idx[i], ty = idx[i + 1], valid = idx[i + 3];
        if (valid === 1) {
            const fi = ty * fullWidth + tx;
            const ci = i / 4;
            data[fi * 4] = ci % compWidth;
            data[fi * 4 + 1] = Math.floor(ci / compWidth);
            data[fi * 4 + 2] = 1;
            data[fi * 4 + 3] = 1;
        }
    }
    return data;
}

function runDirectionator() {
    const dirFBO = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, dirFBO);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, dir0, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, dir1, 0);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
    gl.viewport(0, 0, compWidth, compHeight);
    gl.useProgram(dirProgram);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, fullTexelIndex);
    gl.uniform1i(gl.getUniformLocation(dirProgram, 'fullTexelIndex'), 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, compressedTexelIndex);
    gl.uniform1i(gl.getUniformLocation(dirProgram, 'compressedTexelIndex'), 1);
    gl.uniform1i(gl.getUniformLocation(dirProgram, 'mx'), mx);
    gl.uniform1i(gl.getUniformLocation(dirProgram, 'my'), my);
    gl.bindVertexArray(quadVAO);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(dirFBO);
}

function initSimulation(struct) {
    const meta = struct.metadata;
    compWidth = meta.compWidth; compHeight = meta.compHeight;
    fullWidth = meta.fullWidth; fullHeight = meta.fullHeight;
    mx = meta.mx; my = meta.my;
    simParams.lx = 0.0625 * (fullWidth / mx);

    // quad for compute passes
    const qv = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);
    quadBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, qv, gl.STATIC_DRAW);
    quadVAO = gl.createVertexArray();
    gl.bindVertexArray(quadVAO);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    // state textures with initial values U=0,V=1,W=1,D=0.03
    fcolor0 = mkF32Tex(compWidth, compHeight);
    scolor0 = mkF32Tex(compWidth, compHeight);
    const initData = new Float32Array(compWidth * compHeight * 4);
    for (let i = 0; i < compWidth * compHeight; i++) {
        initData[i * 4] = 0; initData[i * 4 + 1] = 1; initData[i * 4 + 2] = 1; initData[i * 4 + 3] = 0.03;
    }
    [fcolor0, scolor0].forEach(t => {
        gl.bindTexture(gl.TEXTURE_2D, t);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, compWidth, compHeight, gl.RGBA, gl.FLOAT, initData);
    });
    fbo0 = mkFBO(scolor0);
    fbo1 = mkFBO(fcolor0);

    // direction textures
    dir0 = mkU32Tex(compWidth, compHeight);
    dir1 = mkU32Tex(compWidth, compHeight);

    // texel index textures
    fullTexelIndex = mkU32Tex(compWidth, compHeight, new Uint32Array(struct.raw.fullTexelIndex));
    const ciData = buildCompressedTexelIndex(struct.raw);
    compressedTexelIndex = mkU32Tex(fullWidth, fullHeight, ciData);

    // compile simulation programs
    dirProgram = mkProgram(gl, QUAD_VS, DIRECTIONATOR_FS, 'Directionator');
    stepProgram = mkProgram(gl, QUAD_VS, TIMESTEP_FS, 'TimeStep');
    paceProgram = mkProgram(gl, QUAD_VS, PACE_FS, 'Pace');

    if (!dirProgram || !stepProgram || !paceProgram) {
        console.error('Failed to compile simulation shaders'); return;
    }

    runDirectionator();
    simInitialized = true;
    console.log(`Simulation initialized — grid ${fullWidth / mx}^3, lx=${simParams.lx.toFixed(3)}`);
}

function stepSimulation(n = 1) {
    if (!simInitialized) return;
    gl.disable(gl.BLEND);
    for (let i = 0; i < n; i++) {
        const readTex = currentBuffer === 0 ? fcolor0 : scolor0;
        const writeFBO = currentBuffer === 0 ? fbo0 : fbo1;
        gl.bindFramebuffer(gl.FRAMEBUFFER, writeFBO);
        gl.viewport(0, 0, compWidth, compHeight);
        gl.useProgram(stepProgram);
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, readTex);
        gl.uniform1i(gl.getUniformLocation(stepProgram, 'icolor0'), 0);
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, dir0);
        gl.uniform1i(gl.getUniformLocation(stepProgram, 'idir0'), 1);
        gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, dir1);
        gl.uniform1i(gl.getUniformLocation(stepProgram, 'idir1'), 2);
        const p = simParams, res = fullWidth / mx;
        gl.uniform1f(gl.getUniformLocation(stepProgram, 'dt'), p.dt);
        gl.uniform1f(gl.getUniformLocation(stepProgram, 'diffCoef'), p.diffCoef);
        gl.uniform1f(gl.getUniformLocation(stepProgram, 'lx'), p.lx);
        gl.uniform1f(gl.getUniformLocation(stepProgram, 'C_m'), p.C_m);
        gl.uniform1i(gl.getUniformLocation(stepProgram, 'resolution'), res);
        gl.uniform1f(gl.getUniformLocation(stepProgram, 'u_na'), p.u_na);
        gl.uniform1f(gl.getUniformLocation(stepProgram, 'u_c'), p.u_c);
        gl.uniform1f(gl.getUniformLocation(stepProgram, 'u_v'), p.u_v);
        gl.uniform1f(gl.getUniformLocation(stepProgram, 'u_w'), p.u_w);
        gl.uniform1f(gl.getUniformLocation(stepProgram, 'u_d'), p.u_d);
        gl.uniform1f(gl.getUniformLocation(stepProgram, 'u_m'), p.u_m);
        gl.uniform1f(gl.getUniformLocation(stepProgram, 'u_0'), p.u_0);
        gl.uniform1f(gl.getUniformLocation(stepProgram, 'u_so'), p.u_so);
        gl.uniform1f(gl.getUniformLocation(stepProgram, 'x_tso'), p.x_tso);
        gl.uniform1f(gl.getUniformLocation(stepProgram, 'x_k'), p.x_k);
        gl.uniform1f(gl.getUniformLocation(stepProgram, 'u_csi'), p.u_csi);
        gl.uniform1f(gl.getUniformLocation(stepProgram, 't_d'), p.t_d);
        gl.uniform1f(gl.getUniformLocation(stepProgram, 't_soa'), p.t_soa);
        gl.uniform1f(gl.getUniformLocation(stepProgram, 't_sob'), p.t_sob);
        gl.uniform1f(gl.getUniformLocation(stepProgram, 't_o'), p.t_o);
        gl.uniform1f(gl.getUniformLocation(stepProgram, 't_si'), p.t_si);
        gl.uniform1f(gl.getUniformLocation(stepProgram, 't_vm'), p.t_vm);
        gl.uniform1f(gl.getUniformLocation(stepProgram, 't_vmm'), p.t_vmm);
        gl.uniform1f(gl.getUniformLocation(stepProgram, 't_vp'), p.t_vp);
        gl.uniform1f(gl.getUniformLocation(stepProgram, 't_wm'), p.t_wm);
        gl.uniform1f(gl.getUniformLocation(stepProgram, 't_wp'), p.t_wp);
        gl.uniform1f(gl.getUniformLocation(stepProgram, 't_sm'), p.t_sm);
        gl.uniform1f(gl.getUniformLocation(stepProgram, 't_sp'), p.t_sp);
        gl.bindVertexArray(quadVAO);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        gl.bindVertexArray(null);
        currentBuffer = 1 - currentBuffer;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

function paceRegion(cx, cy, cz, radius = 8) {
    if (!simInitialized || !structure) return;
    const data = new Float32Array(compWidth * compHeight * 4);
    for (let i = 0; i < compWidth * compHeight; i++) {
        data[i * 4 + 0] = 0.0; data[i * 4 + 1] = 1.0; data[i * 4 + 2] = 1.0; data[i * 4 + 3] = 0.03;
    }
    const n = Math.min(structure.voxels.length, compWidth * compHeight);
    for (let i = 0; i < n; i++) {
        const { x, y, z } = structure.voxels[i];
        const d = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2 + (z - cz) ** 2);
        if (d < radius) data[i * 4] = 1.0;
    }
    for (const tex of [fcolor0, scolor0]) {
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, compWidth, compHeight, gl.RGBA, gl.FLOAT, data);
    }
    gl.bindTexture(gl.TEXTURE_2D, null);
    currentBuffer = 0;
    console.log(`CPU-paced at (${cx},${cy},${cz}) r=${radius}`);
}


function getVoltageTex() { return currentBuffer === 0 ? fcolor0 : scolor0; }

function debugVoltage() {
    console.log('--- DEBUG ---');
    console.log('simInitialized:', simInitialized, '| currentBuffer:', currentBuffer);
    console.log('compWidth:', compWidth, '| compHeight:', compHeight);

    // check render-shader uniform locations
    const uloc = gl.getUniformLocation(peelProg, 'u_useSimTex');
    const vloc = gl.getUniformLocation(peelProg, 'u_voltageTex');
    const cloc = gl.getUniformLocation(peelProg, 'u_compWidth');
    console.log('u_useSimTex loc:', uloc, '| u_voltageTex loc:', vloc, '| u_compWidth loc:', cloc);

    const readTex = getVoltageTex();
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, readTex, 0);
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    console.log('Readback FBO status:', status === gl.FRAMEBUFFER_COMPLETE ? 'COMPLETE' : status);

    if (status === gl.FRAMEBUFFER_COMPLETE) {
        const totalPx = compWidth * compHeight;
        const buf = new Float32Array(totalPx * 4);
        gl.readPixels(0, 0, compWidth, compHeight, gl.RGBA, gl.FLOAT, buf);
        let maxU = 0, nonZeroCount = 0;
        for (let i = 0; i < totalPx; i++) {
            const u = buf[i * 4];
            if (u > 0.001) nonZeroCount++;
            maxU = Math.max(maxU, u);
        }
        console.log('Max U across full texture:', maxU.toFixed(4));
        console.log('Non-zero voxels (U>0.001):', nonZeroCount, 'of', totalPx);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(fbo);

    const testData = new Float32Array([1, 1, 1, 1]);
    for (const tex of [fcolor0, scolor0]) {
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 1, 1, gl.RGBA, gl.FLOAT, testData);
    }
    console.log('Force-painted voxel 0 -> U=1. If that surface voxel turns red, render path works.');
}

// ============================================================================
// NORMAL COMPUTATION
// ============================================================================
function computeNormals(struct) {
    const set = new Set(struct.voxels.map(v => `${v.x},${v.y},${v.z}`));
    const getU = (x, y, z) => set.has(`${x},${y},${z}`) ? 0 : 1;
    const grad = (vx, vy, vz, dx, dy, dz) => getU(vx + dx, vy + dy, vz + dz) - getU(vx - dx, vy - dy, vz - dz);
    const omega = 0.586, pw = 2 * omega + 1, sw = (1 - omega) / Math.sqrt(2);
    const normals = new Float32Array(numVoxels * 4);
    for (let i = 0; i < numVoxels; i++) {
        const { x, y, z } = struct.voxels[i];
        const dii = grad(x, y, z, 1, 0, 0), djj = grad(x, y, z, 0, 1, 0), dkk = grad(x, y, z, 0, 0, 1);
        const dij = grad(x, y, z, 0, 1, 1), dik = grad(x, y, z, 0, -1, 1);
        const dji = grad(x, y, z, 1, 0, 1), djk = grad(x, y, z, -1, 0, 1);
        const dki = grad(x, y, z, 1, 1, 0), dkj = grad(x, y, z, -1, 1, 0);
        let nx = pw * dii + sw * (dji + dki - djk - dkj);
        let ny = pw * djj + sw * (dij + dki - dik - dkj);
        let nz = pw * dkk + sw * (dij + dji - dik - djk);
        const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
        if (len > 0.001) { nx /= len; ny /= len; nz /= len; }
        normals[i * 4] = nx; normals[i * 4 + 1] = ny; normals[i * 4 + 2] = nz; normals[i * 4 + 3] = len > 0.001 ? 1 : 0;
    }
    return normals;
}

// ============================================================================
// BUILD RENDERING TEXTURES
// ============================================================================
function buildRenderTextures(struct) {
    numVoxels = struct.voxels.length;
    texWidth = Math.ceil(Math.sqrt(numVoxels));
    texHeight = Math.ceil(numVoxels / texWidth);
    const { nx, ny, nz } = struct.dimensions;
    const maxDim = Math.max(nx, ny, nz);
    const posData = new Float32Array(texWidth * texHeight * 4);
    for (let i = 0; i < numVoxels; i++) {
        const v = struct.voxels[i];
        posData[i * 4] = v.x / maxDim;
        posData[i * 4 + 1] = v.y / maxDim;
        posData[i * 4 + 2] = v.z / maxDim;
        posData[i * 4 + 3] = 1.0;
    }
    const normalData = computeNormals(struct);
    const normalFull = new Float32Array(texWidth * texHeight * 4);
    normalFull.set(normalData);

    function mkPosTex(data) {
        const t = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, t);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, texWidth, texHeight, 0, gl.RGBA, gl.FLOAT, data);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        return t;
    }
    posTex = mkPosTex(posData);
    normalTex = mkPosTex(normalFull);
    console.log(`Render textures: ${numVoxels} voxels in ${texWidth}×${texHeight}`);
}

// ============================================================================
// DRAW VOXELS
// ============================================================================
function drawVoxels(projMatrix, viewMatrix, modelMatrix) {
    if (!peelProg || !posTex || numVoxels === 0) return;
    gl.useProgram(peelProg);

    const nm = normalMat(modelMatrix);

    gl.uniformMatrix4fv(gl.getUniformLocation(peelProg, 'u_projectionMatrix'), false, projMatrix);
    gl.uniformMatrix4fv(gl.getUniformLocation(peelProg, 'u_viewMatrix'), false, viewMatrix);
    gl.uniformMatrix4fv(gl.getUniformLocation(peelProg, 'u_modelMatrix'), false, modelMatrix);
    gl.uniformMatrix4fv(gl.getUniformLocation(peelProg, 'u_normalMatrix'), false, nm);

    gl.uniform1i(gl.getUniformLocation(peelProg, 'u_noVoxels'), numVoxels);
    gl.uniform1f(gl.getUniformLocation(peelProg, 'u_voxelSize'), VOXEL_SIZE);
    gl.uniform1f(gl.getUniformLocation(peelProg, 'u_alpha'), ALPHA);

    // lighting
    gl.uniform4f(gl.getUniformLocation(peelProg, 'u_lightColor'), 1, 1, 1, 1);
    gl.uniform1f(gl.getUniformLocation(peelProg, 'u_lightAmbientTerm'), 0.0);
    gl.uniform1f(gl.getUniformLocation(peelProg, 'u_lightSpecularTerm'), 0.5);
    gl.uniform3fv(gl.getUniformLocation(peelProg, 'u_lightDirection'), LIGHT_DIR);
    gl.uniform4f(gl.getUniformLocation(peelProg, 'u_materialColor'), 0.9, 0.9, 0.9, 1);
    gl.uniform1f(gl.getUniformLocation(peelProg, 'u_materialAmbientTerm'), 1.9);
    gl.uniform1f(gl.getUniformLocation(peelProg, 'u_materialSpecularTerm'), 0.8);
    gl.uniform1f(gl.getUniformLocation(peelProg, 'u_shininess'), 10.0);

    // position & normal textures
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, posTex);
    gl.uniform1i(gl.getUniformLocation(peelProg, 'u_posTex'), 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, normalTex);
    gl.uniform1i(gl.getUniformLocation(peelProg, 'u_normalTex'), 1);

    // simulation voltage texture
    if (simInitialized) {
        gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, getVoltageTex());
        gl.uniform1i(gl.getUniformLocation(peelProg, 'u_voltageTex'), 2);
        gl.uniform1i(gl.getUniformLocation(peelProg, 'u_compWidth'), compWidth);
        gl.uniform1i(gl.getUniformLocation(peelProg, 'u_useSimTex'), 1);
    } else {
        gl.uniform1i(gl.getUniformLocation(peelProg, 'u_useSimTex'), 0);
    }

    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
    gl.depthFunc(gl.LESS);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.disable(gl.BLEND);

    gl.drawArrays(gl.TRIANGLES, 0, 36 * numVoxels);
    gl.disable(gl.CULL_FACE);
}

// ============================================================================
// INIT GL
// ============================================================================
function initGL() {
    const canvas = document.createElement('canvas');
    gl = canvas.getContext('webgl2', { xrCompatible: true, antialias: true, alpha: false });
    if (!gl) { console.error('WebGL2 not available'); return false; }
    gl.getExtension('EXT_color_buffer_float');
    peelProg = mkProgram(gl, PEEL_VS, PEEL_FS, 'DepthPeel');
    if (!peelProg) return false;
    initVRControllers(gl);
    initVRPanel(gl);
    return true;
}

// ============================================================================
// LAB
// ============================================================================
function buildLabMatrix() {
    const s = 3.0;
    labModelMatrix = new Float32Array([0, -s, 0, 0, 0, 0, -s, 0, s, 0, 0, 0, -18, -4, 16, 1]);
}

// ============================================================================
// VR FRAME
// ============================================================================
function onXRFrame(time, frame) {
    if (!xrSession) return;
    xrSession.requestAnimationFrame(onXRFrame);
    updateControllers(frame, xrReferenceSpace);
    updateStructureManipulation();

    if (simRunning) stepSimulation(stepsPerFrame);

    const pose = frame.getViewerPose(xrReferenceSpace);
    if (!pose) return;
    const glLayer = xrSession.renderState.baseLayer;
    gl.bindFramebuffer(gl.FRAMEBUFFER, glLayer.framebuffer);
    gl.disable(gl.SCISSOR_TEST);
    gl.clearColor(1, 1, 1, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    const modelMatrix = getStructureModelMatrix();

    // update panel hover once per frame (not per view)
    updatePanelHover(getLeftController(), getRightController());

    for (const view of pose.views) {
        const vp = glLayer.getViewport(view);
        gl.enable(gl.SCISSOR_TEST);
        gl.scissor(vp.x, vp.y, vp.width, vp.height);
        gl.viewport(vp.x, vp.y, vp.width, vp.height);
        drawVoxels(view.projectionMatrix, view.transform.inverse.matrix, modelMatrix);
        if (isLabLoaded()) {
            if (!labModelMatrix) buildLabMatrix();
            gl.disable(gl.BLEND);
            gl.enable(gl.DEPTH_TEST);
            renderLab(gl, view.projectionMatrix, view.transform.inverse.matrix, labModelMatrix);
        }
        // VR panel + controller rays rendered on top of everything
        renderVRPanel(view.projectionMatrix, view.transform.inverse.matrix);
        renderControllerRays(gl, view.projectionMatrix, view.transform.inverse.matrix);
    }
    gl.disable(gl.SCISSOR_TEST);
}

// ============================================================================
// DESKTOP LOOP
// ============================================================================
function nonVRLoop() {
    requestAnimationFrame(nonVRLoop);
    if (xrSession || !structure) return;
    if (simRunning) stepSimulation(stepsPerFrame);
    const canvas = gl.canvas;
    canvas.width = window.innerWidth; canvas.height = window.innerHeight;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0.36, 0.23, 0.56, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    const proj = mat4u.create();
    mat4u.perspective(proj, 0.44, canvas.width / canvas.height, 0.01, 100);
    const view = mat4u.create();
    mat4u.lookAt(view, [0, 0, 3], [0, 0, 0], [0, 1, 0]);
    drawVoxels(proj, view, getStructureModelMatrix());
}

// ============================================================================
// VR ENTRY
// ============================================================================
async function enterVR() {
    if (xrSession) { xrSession.end(); return; }
    try {
        const session = await navigator.xr.requestSession('immersive-vr', {
            optionalFeatures: ['hand-tracking']
        });
        xrSession = session;
        setupControllerInput(session);
        session.addEventListener('end', () => {
            xrSession = null; xrReferenceSpace = null;
            document.getElementById('vr-button').textContent = 'Enter VR';
        });
        await gl.makeXRCompatible();
        await session.updateRenderState({ baseLayer: new XRWebGLLayer(session, gl) });
        xrReferenceSpace = await session.requestReferenceSpace('local');
        document.getElementById('vr-button').textContent = 'Exit VR';
        session.requestAnimationFrame(onXRFrame);
    } catch (e) {
        console.error('VR error:', e);
        document.getElementById('status').textContent = `VR error: ${e.message}`;
    }
}

// ============================================================================
// STARTUP
// ============================================================================
const STRUCTURE_PATHS = {
    whole: './resources/whole_64x64x64.json',
    atria: './resources/atria2.json',
    ventricle: './resources/ventricle_64x64x64.json',
};

window.addEventListener('load', async () => {
    const vrBtn = document.getElementById('vr-button');
    const statusDiv = document.getElementById('status');
    const simBtn = document.getElementById('sim-button');
    const paceBtn = document.getElementById('pace-button');
    const resetBtn = document.getElementById('reset-button');

    const sel = document.querySelector('input[name="structure"]:checked');
    const PATH = STRUCTURE_PATHS[sel?.value] || STRUCTURE_PATHS.whole;

    if (!initGL()) { statusDiv.textContent = 'WebGL2 init failed'; return; }

    gl.canvas.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;z-index:-1';
    document.body.appendChild(gl.canvas);

    const slider = document.getElementById('voxel-scale');
    if (slider) {
        slider.value = VOXEL_SIZE;
        document.getElementById('scale-value').textContent = VOXEL_SIZE.toFixed(1);
        slider.addEventListener('input', e => {
            VOXEL_SIZE = parseFloat(e.target.value);
            document.getElementById('scale-value').textContent = VOXEL_SIZE.toFixed(1);
        });
    }

    statusDiv.textContent = 'Loading…';

    const [structBuf, labBuf] = await Promise.all([
        fetchWithProgress('Heart structure', PATH).catch(e => { console.error(e); return null; }),
        fetchWithProgress('Lab environment',
            'https://pi9k1iia1f4aeulw.public.blob.vercel-storage.com/cath-lab.glb').catch(() => null),
    ]);

    if (structBuf) {
        try {
            const json = JSON.parse(new TextDecoder().decode(structBuf));
            structure = await loadStructure(json);
            buildRenderTextures(structure);
            initSimulation(structure);
            statusDiv.textContent = `${structure.voxels.length} voxels | sim ready`;
            if (simBtn) simBtn.disabled = false;
            if (paceBtn) paceBtn.disabled = false;
            if (resetBtn) resetBtn.disabled = false;

            // compute true centroid of voxels (heart not necessarily at grid center)
            let sumX = 0, sumY = 0, sumZ = 0;
            for (const v of structure.voxels) { sumX += v.x; sumY += v.y; sumZ += v.z; }
            const vn = structure.voxels.length;
            const cx = Math.round(sumX / vn), cy = Math.round(sumY / vn), cz = Math.round(sumZ / vn);
            console.log(`Voxel centroid: (${cx}, ${cy}, ${cz})`);

            const startSim = () => {
                simRunning = !simRunning;
                if (simRunning) paceRegion(cx, cy, cz, 12);
                console.log(simRunning ? '▶ Sim started' : '⏹ Sim stopped');
            };
            setPanelCallbacks({
                startSimulation: startSim,
                resetView: () => { paceRegion(cx, cy, cz, 12); },
            });
            setPaceCallback((x, y, z) => paceRegion(x, y, z, 12));

        } catch (e) {
            console.error(e);
            statusDiv.textContent = 'Structure load failed: ' + e.message;
        }
    }

    if (labBuf) { try { await loadLabModel(gl, labBuf); } catch (e) { console.warn(e); } }

    // simulation controls
    if (simBtn) {
        simBtn.addEventListener('click', () => {
            simRunning = !simRunning;
            if (simRunning) {
                // compute centroid at click time
                let sx = 0, sy = 0, sz = 0;
                for (const v of structure.voxels) { sx += v.x; sy += v.y; sz += v.z; }
                const n2 = structure.voxels.length;
                paceRegion(Math.round(sx / n2), Math.round(sy / n2), Math.round(sz / n2), 12);
            }
            simBtn.textContent = simRunning ? 'Stop Sim' : 'Run Sim';
        });
    }
    if (paceBtn) {
        paceBtn.addEventListener('click', () => {
            let sx = 0, sy = 0, sz = 0;
            for (const v of structure.voxels) { sx += v.x; sy += v.y; sz += v.z; }
            const n2 = structure.voxels.length;
            paceRegion(Math.round(sx / n2), Math.round(sy / n2), Math.round(sz / n2), 12);
            statusDiv.textContent = 'Paced at centroid!';
        });
    }
    if (resetBtn) {
        resetBtn.addEventListener('click', () => {
            // reinitialize state
            const initData = new Float32Array(compWidth * compHeight * 4);
            for (let i = 0; i < compWidth * compHeight; i++) {
                initData[i * 4] = 0; initData[i * 4 + 1] = 1; initData[i * 4 + 2] = 1; initData[i * 4 + 3] = 0.03;
            }
            [fcolor0, scolor0].forEach(t => {
                gl.bindTexture(gl.TEXTURE_2D, t);
                gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, compWidth, compHeight, gl.RGBA, gl.FLOAT, initData);
            });
            currentBuffer = 0;
            simRunning = false;
            if (simBtn) simBtn.textContent = 'Run Sim';
            statusDiv.textContent = 'Simulation reset';
        });
    }

    try {
        if (await navigator.xr?.isSessionSupported('immersive-vr')) {
            vrBtn.disabled = false;
            vrBtn.addEventListener('click', enterVR);
            statusDiv.textContent += ' — VR ready';
        }
    } catch (e) { console.error(e); }

    window.addEventListener('keydown', e => {
        if (!simInitialized) return;
        // compute centroid (heart isn't necessarily at grid center)
        let sx = 0, sy = 0, sz = 0;
        for (const v of structure.voxels) { sx += v.x; sy += v.y; sz += v.z; }
        const vn = structure.voxels.length;
        const cx = Math.round(sx / vn), cy = Math.round(sy / vn), cz = Math.round(sz / vn);
        if (e.code === 'Space') {
            e.preventDefault();
            simRunning = !simRunning;
            if (simRunning) paceRegion(cx, cy, cz, 12);
            if (simBtn) simBtn.textContent = simRunning ? 'Stop Sim' : 'Run Sim';
            console.log(simRunning ? '▶ Sim running' : '⏹ Sim stopped');
        } else if (e.code === 'KeyP') {
            paceRegion(cx, cy, cz, 12);
            console.log(`⚡ Paced at centroid (${cx},${cy},${cz})`);
        } else if (e.code === 'KeyD') {
            debugVoltage();
        } else if (e.code === 'KeyR') {
            const initData = new Float32Array(compWidth * compHeight * 4);
            for (let i = 0; i < compWidth * compHeight; i++) {
                initData[i * 4] = 0; initData[i * 4 + 1] = 1;
                initData[i * 4 + 2] = 1; initData[i * 4 + 3] = 0.03;
            }
            [fcolor0, scolor0].forEach(t => {
                gl.bindTexture(gl.TEXTURE_2D, t);
                gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, compWidth, compHeight, gl.RGBA, gl.FLOAT, initData);
            });
            currentBuffer = 0;
            simRunning = false;
            if (simBtn) simBtn.textContent = 'Run Sim';
            console.log('🔄 Sim reset');
        }
    });

    nonVRLoop();
});
