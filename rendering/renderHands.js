import { isHandPinching } from './handTracking.js';

// ============================================================================
// JOINT NAMES — all 25 per XRHand spec
// ============================================================================
const JOINTS = [
    'wrist',
    'thumb-metacarpal', 'thumb-phalanx-proximal', 'thumb-phalanx-distal', 'thumb-tip',
    'index-finger-metacarpal', 'index-finger-phalanx-proximal', 'index-finger-phalanx-intermediate', 'index-finger-phalanx-distal', 'index-finger-tip',
    'middle-finger-metacarpal', 'middle-finger-phalanx-proximal', 'middle-finger-phalanx-intermediate', 'middle-finger-phalanx-distal', 'middle-finger-tip',
    'ring-finger-metacarpal',   'ring-finger-phalanx-proximal',   'ring-finger-phalanx-intermediate',   'ring-finger-phalanx-distal',   'ring-finger-tip',
    'pinky-finger-metacarpal',  'pinky-finger-phalanx-proximal',  'pinky-finger-phalanx-intermediate',  'pinky-finger-phalanx-distal',  'pinky-finger-tip',
];

const BONES = [
    // wrist → each metacarpal
    [0, 1], [0, 5], [0, 10], [0, 15], [0, 20],
    // thumb
    [1, 2], [2, 3], [3, 4],
    // index
    [5, 6], [6, 7], [7, 8], [8, 9],
    // middle
    [10, 11], [11, 12], [12, 13], [13, 14],
    // ring
    [15, 16], [16, 17], [17, 18], [18, 19],
    // pinky
    [20, 21], [21, 22], [22, 23], [23, 24],
];

// ============================================================================
// COLORS
// ============================================================================
const COLOR_DEFAULT  = [0.85, 0.85, 0.90, 1.0];
const COLOR_PINCHING = [1.0,  0.85, 0.35, 1.0];
const JOINT_RADIUS   = 0.007;  // 7 mm
const BONE_RADIUS    = 0.003;  // 3 mm

// ============================================================================
// SHADERS
// ============================================================================
const SPHERE_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec3  a_position;
layout(location = 1) in vec3  a_normal;
layout(location = 2) in vec4  a_instanceColor;
layout(location = 3) in mat4  a_instanceMatrix; // occupies locations 3-6

uniform mat4 u_projection;
uniform mat4 u_view;

out vec3  v_normal;
out vec4  v_color;

void main() {
    vec4 worldPos = a_instanceMatrix * vec4(a_position, 1.0);
    v_normal  = normalize(mat3(a_instanceMatrix) * a_normal);
    v_color   = a_instanceColor;
    gl_Position = u_projection * u_view * worldPos;
}`;

const SPHERE_FS = `#version 300 es
precision mediump float;
in vec3 v_normal;
in vec4 v_color;
out vec4 fragColor;

void main() {
    vec3 L = normalize(vec3(0.4, 0.8, 0.5));
    float diff    = max(dot(normalize(v_normal), L), 0.0);
    float ambient = 0.35;
    float light   = ambient + (1.0 - ambient) * diff;
    fragColor = vec4(v_color.rgb * light, v_color.a);
}`;

const BONE_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec3 a_position;
layout(location = 1) in vec4 a_instanceColor;
layout(location = 2) in mat4 a_instanceMatrix; // occupies locations 2-5

uniform mat4 u_projection;
uniform mat4 u_view;

out vec4 v_color;

void main() {
    vec4 worldPos = a_instanceMatrix * vec4(a_position, 1.0);
    v_color     = a_instanceColor;
    gl_Position = u_projection * u_view * worldPos;
}`;

const BONE_FS = `#version 300 es
precision mediump float;
in vec4 v_color;
out vec4 fragColor;
void main() { fragColor = v_color; }`;

// ============================================================================
// GL STATE
// ============================================================================
let sphereProgram   = null;
let boneProgram     = null;
let sphereVAO       = null;
let boneVAO         = null;
let sphereIndexCount = 0;
let boneIndexCount   = 0;

let jointColorBuf = null;
let jointMatBuf   = null;
let boneColorBuf  = null;
let boneMatBuf    = null;

const MAX_JOINTS = 25;
const MAX_BONES  = BONES.length; // 23

// ============================================================================
// SHADER HELPERS
// ============================================================================
function compileShader(gl, src, type) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        console.error('Hand shader error:', gl.getShaderInfoLog(s));
        return null;
    }
    return s;
}

function mkProg(gl, vs, fs) {
    const p = gl.createProgram();
    gl.attachShader(p, compileShader(gl, vs, gl.VERTEX_SHADER));
    gl.attachShader(p, compileShader(gl, fs, gl.FRAGMENT_SHADER));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
        console.error('Hand program link error:', gl.getProgramInfoLog(p));
        return null;
    }
    return p;
}

// ============================================================================
// GEOMETRY — low-poly icosphere
// ============================================================================
function buildIcosphere(radius, subdivisions) {
    const t = (1 + Math.sqrt(5)) / 2;
    const base = [
        [-1,  t,  0], [ 1,  t,  0], [-1, -t,  0], [ 1, -t,  0],
        [ 0, -1,  t], [ 0,  1,  t], [ 0, -1, -t], [ 0,  1, -t],
        [ t,  0, -1], [ t,  0,  1], [-t,  0, -1], [-t,  0,  1],
    ].map(v => { const l = Math.sqrt(v[0]*v[0]+v[1]*v[1]+v[2]*v[2]); return [v[0]/l, v[1]/l, v[2]/l]; });

    let faces = [
        [0,11,5],[0,5,1],[0,1,7],[0,7,10],[0,10,11],
        [1,5,9],[5,11,4],[11,10,2],[10,7,6],[7,1,8],
        [3,9,4],[3,4,2],[3,2,6],[3,6,8],[3,8,9],
        [4,9,5],[2,4,11],[6,2,10],[8,6,7],[9,8,1],
    ];

    const midCache = new Map();
    function midpoint(a, b) {
        const key = Math.min(a,b) + '_' + Math.max(a,b);
        if (midCache.has(key)) return midCache.get(key);
        const v = base[a], w = base[b];
        const m = [(v[0]+w[0])/2, (v[1]+w[1])/2, (v[2]+w[2])/2];
        const l = Math.sqrt(m[0]*m[0]+m[1]*m[1]+m[2]*m[2]);
        base.push([m[0]/l, m[1]/l, m[2]/l]);
        const idx = base.length - 1;
        midCache.set(key, idx);
        return idx;
    }

    for (let s = 0; s < subdivisions; s++) {
        const next = [];
        for (const [a, b, c] of faces) {
            const ab = midpoint(a, b), bc = midpoint(b, c), ca = midpoint(c, a);
            next.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
        }
        faces = next;
    }

    const positions = [];
    const normals   = [];
    const indices   = [];
    base.forEach(v => { positions.push(v[0]*radius, v[1]*radius, v[2]*radius); normals.push(v[0], v[1], v[2]); });
    faces.forEach(([a, b, c]) => indices.push(a, b, c));

    return { positions: new Float32Array(positions), normals: new Float32Array(normals), indices: new Uint16Array(indices) };
}

// ============================================================================
// GEOMETRY — bone cylinder (along +Y, from 0 to 1, to be scaled by bone length)
// ============================================================================
function buildBoneCylinder(radius, segments) {
    const positions = [];
    const indices   = [];

    for (let i = 0; i <= segments; i++) {
        const a = (i / segments) * Math.PI * 2;
        const x = Math.cos(a) * radius;
        const z = Math.sin(a) * radius;
        positions.push(x, 0, z);  // bottom ring (y=0)
        positions.push(x, 1, z);  // top ring    (y=1)
    }

    for (let i = 0; i < segments; i++) {
        const b0 = i * 2, b1 = (i + 1) * 2;
        const t0 = b0 + 1, t1 = b1 + 1;
        indices.push(b0, t0, b1, b1, t0, t1);
    }

    return { positions: new Float32Array(positions), indices: new Uint16Array(indices) };
}

// ============================================================================
// INSTANCE BUFFER SETUP
// ============================================================================
function makeInstanceBufs(gl, prog, maxInstances, colorLoc, matStartLoc) {
    const colorBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, colorBuf);
    gl.bufferData(gl.ARRAY_BUFFER, maxInstances * 4 * 4, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(colorLoc);
    gl.vertexAttribPointer(colorLoc, 4, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(colorLoc, 1);

    const matBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, matBuf);
    gl.bufferData(gl.ARRAY_BUFFER, maxInstances * 16 * 4, gl.DYNAMIC_DRAW);
    for (let col = 0; col < 4; col++) {
        const loc = matStartLoc + col;
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, 4, gl.FLOAT, false, 64, col * 16);
        gl.vertexAttribDivisor(loc, 1);
    }

    return { colorBuf, matBuf };
}

// ============================================================================
// INIT
// ============================================================================
export function initHandRenderer(gl) {
    sphereProgram = mkProg(gl, SPHERE_VS, SPHERE_FS);
    boneProgram   = mkProg(gl, BONE_VS,   BONE_FS);
    if (!sphereProgram || !boneProgram) return false;

    // --- Sphere VAO ---
    const sphere = buildIcosphere(JOINT_RADIUS, 2);
    sphereIndexCount = sphere.indices.length;

    sphereVAO = gl.createVertexArray();
    gl.bindVertexArray(sphereVAO);

    const spherePosBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, spherePosBuf);
    gl.bufferData(gl.ARRAY_BUFFER, sphere.positions, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);

    const sphereNrmBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, sphereNrmBuf);
    gl.bufferData(gl.ARRAY_BUFFER, sphere.normals, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);

    const sphereIdxBuf = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, sphereIdxBuf);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, sphere.indices, gl.STATIC_DRAW);

    const sInst = makeInstanceBufs(gl, sphereProgram, MAX_JOINTS * 2, 2, 3);
    jointColorBuf = sInst.colorBuf;
    jointMatBuf   = sInst.matBuf;

    gl.bindVertexArray(null);

    // --- Bone VAO ---
    const bone = buildBoneCylinder(BONE_RADIUS, 6);
    boneIndexCount = bone.indices.length;

    boneVAO = gl.createVertexArray();
    gl.bindVertexArray(boneVAO);

    const bonePosBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, bonePosBuf);
    gl.bufferData(gl.ARRAY_BUFFER, bone.positions, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);

    const boneIdxBuf = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, boneIdxBuf);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, bone.indices, gl.STATIC_DRAW);

    const bInst = makeInstanceBufs(gl, boneProgram, MAX_BONES * 2, 1, 2);
    boneColorBuf = bInst.colorBuf;
    boneMatBuf   = bInst.matBuf;

    gl.bindVertexArray(null);

    console.log('✋ Hand renderer initialized');
    return true;
}

// ============================================================================
// MATH HELPERS
// ============================================================================
function normalize3(v) {
    const l = Math.sqrt(v[0]*v[0] + v[1]*v[1] + v[2]*v[2]);
    return l > 0.0001 ? [v[0]/l, v[1]/l, v[2]/l] : [0, 1, 0];
}

function cross3(a, b) {
    return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
}

function sphereMatrix(x, y, z) {
    const m = new Float32Array(16);
    m[0]=1; m[5]=1; m[10]=1; m[15]=1;
    m[12]=x; m[13]=y; m[14]=z;
    return m;
}

function boneMatrix(ax, ay, az, bx, by, bz) {
    const dx = bx-ax, dy = by-ay, dz = bz-az;
    const len = Math.sqrt(dx*dx + dy*dy + dz*dz);
    if (len < 0.0001) return null;

    const yAxis = [dx/len, dy/len, dz/len];
    const ref   = Math.abs(yAxis[1]) < 0.99 ? [0,1,0] : [1,0,0];
    const xAxis = normalize3(cross3(ref, yAxis));
    const zAxis = cross3(yAxis, xAxis);

    const m = new Float32Array(16);
    m[0]  = xAxis[0]*BONE_RADIUS/BONE_RADIUS; // x scale handled by geometry
    m[1]  = xAxis[1];
    m[2]  = xAxis[2];
    m[3]  = 0;
    m[4]  = yAxis[0]*len;
    m[5]  = yAxis[1]*len;
    m[6]  = yAxis[2]*len;
    m[7]  = 0;
    m[8]  = zAxis[0];
    m[9]  = zAxis[1];
    m[10] = zAxis[2];
    m[11] = 0;
    m[12] = ax;
    m[13] = ay;
    m[14] = az;
    m[15] = 1;
    return m;
}

// ============================================================================
// RENDER
// ============================================================================
export function renderHands(gl, frame, referenceSpace, projMatrix, viewMatrix) {
    if (!sphereProgram || !frame || !referenceSpace) return;

    const jointColors  = new Float32Array(MAX_JOINTS * 2 * 4);
    const jointMats    = new Float32Array(MAX_JOINTS * 2 * 16);
    const boneColors   = new Float32Array(MAX_BONES  * 2 * 4);
    const boneMats     = new Float32Array(MAX_BONES  * 2 * 16);

    let jointCount = 0;
    let boneCount  = 0;

    for (const src of frame.session.inputSources) {
        if (!src.hand) continue;

        const pinching = isHandPinching(src.handedness);
        const col = pinching ? COLOR_PINCHING : COLOR_DEFAULT;

        const positions = new Array(JOINTS.length).fill(null);
        for (let i = 0; i < JOINTS.length; i++) {
            const joint = src.hand.get(JOINTS[i]);
            if (!joint) continue;
            const pose = frame.getJointPose(joint, referenceSpace);
            if (!pose) continue;
            const p = pose.transform.position;
            positions[i] = [p.x, p.y, p.z];
        }

        for (let i = 0; i < JOINTS.length; i++) {
            const p = positions[i];
            if (!p) continue;
            const base = jointCount * 16;
            const cbase = jointCount * 4;
            const m = sphereMatrix(p[0], p[1], p[2]);
            jointMats.set(m, base);
            jointColors[cbase]   = col[0];
            jointColors[cbase+1] = col[1];
            jointColors[cbase+2] = col[2];
            jointColors[cbase+3] = col[3];
            jointCount++;
        }

        for (const [ai, bi] of BONES) {
            const a = positions[ai], b = positions[bi];
            if (!a || !b) continue;
            const m = boneMatrix(a[0], a[1], a[2], b[0], b[1], b[2]);
            if (!m) continue;
            const base  = boneCount * 16;
            const cbase = boneCount * 4;
            boneMats.set(m, base);
            boneColors[cbase]   = col[0];
            boneColors[cbase+1] = col[1];
            boneColors[cbase+2] = col[2];
            boneColors[cbase+3] = col[3];
            boneCount++;
        }
    }

    if (jointCount === 0) return;

    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LESS);
    gl.disable(gl.BLEND);

    gl.useProgram(sphereProgram);
    gl.uniformMatrix4fv(gl.getUniformLocation(sphereProgram, 'u_projection'), false, projMatrix);
    gl.uniformMatrix4fv(gl.getUniformLocation(sphereProgram, 'u_view'),       false, viewMatrix);

    gl.bindVertexArray(sphereVAO);

    gl.bindBuffer(gl.ARRAY_BUFFER, jointColorBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, jointColors.subarray(0, jointCount * 4));

    gl.bindBuffer(gl.ARRAY_BUFFER, jointMatBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, jointMats.subarray(0, jointCount * 16));

    gl.drawElementsInstanced(gl.TRIANGLES, sphereIndexCount, gl.UNSIGNED_SHORT, 0, jointCount);
    gl.bindVertexArray(null);

    if (boneCount === 0) return;

    gl.useProgram(boneProgram);
    gl.uniformMatrix4fv(gl.getUniformLocation(boneProgram, 'u_projection'), false, projMatrix);
    gl.uniformMatrix4fv(gl.getUniformLocation(boneProgram, 'u_view'),       false, viewMatrix);

    gl.bindVertexArray(boneVAO);

    gl.bindBuffer(gl.ARRAY_BUFFER, boneColorBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, boneColors.subarray(0, boneCount * 4));

    gl.bindBuffer(gl.ARRAY_BUFFER, boneMatBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, boneMats.subarray(0, boneCount * 16));

    gl.drawElementsInstanced(gl.TRIANGLES, boneIndexCount, gl.UNSIGNED_SHORT, 0, boneCount);
    gl.bindVertexArray(null);
}
