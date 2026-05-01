import { isHandPinching } from './handTracking.js';

const CDN_BASE = 'https://cdn.jsdelivr.net/npm/@webxr-input-profiles/assets@1.0/dist/profiles/generic-hand/';

// XR hand joint names in spec order (index = joint index)
const JOINTS = [
    'wrist',
    'thumb-metacarpal', 'thumb-phalanx-proximal', 'thumb-phalanx-distal', 'thumb-tip',
    'index-finger-metacarpal', 'index-finger-phalanx-proximal', 'index-finger-phalanx-intermediate', 'index-finger-phalanx-distal', 'index-finger-tip',
    'middle-finger-metacarpal', 'middle-finger-phalanx-proximal', 'middle-finger-phalanx-intermediate', 'middle-finger-phalanx-distal', 'middle-finger-tip',
    'ring-finger-metacarpal',   'ring-finger-phalanx-proximal',   'ring-finger-phalanx-intermediate',   'ring-finger-phalanx-distal',   'ring-finger-tip',
    'pinky-finger-metacarpal',  'pinky-finger-phalanx-proximal',  'pinky-finger-phalanx-intermediate',  'pinky-finger-phalanx-distal',  'pinky-finger-tip',
];

const COLOR_DEFAULT  = [0.88, 0.72, 0.60];
const COLOR_PINCHING = [1.00, 0.78, 0.58];

const SKIN_FS = `#version 300 es
precision mediump float;
in vec3 v_normal;
uniform vec3 u_color;
out vec4 fragColor;
void main() {
    vec3 L = normalize(vec3(0.4, 0.8, 0.5));
    float d = max(dot(normalize(v_normal), L), 0.0);
    fragColor = vec4(u_color * (0.35 + 0.65 * d), 1.0);
}`;

function makeSkinVS(n) {
    return `#version 300 es
precision highp float;
in vec3  a_position;
in vec3  a_normal;
in uvec4 a_joints;
in vec4  a_weights;
uniform mat4 u_projection;
uniform mat4 u_view;
uniform mat4 u_bones[${n}];
out vec3 v_normal;
void main() {
    mat4 skin = u_bones[a_joints.x] * a_weights.x
              + u_bones[a_joints.y] * a_weights.y
              + u_bones[a_joints.z] * a_weights.z
              + u_bones[a_joints.w] * a_weights.w;
    v_normal    = normalize(mat3(skin) * a_normal);
    gl_Position = u_projection * u_view * skin * vec4(a_position, 1.0);
}`;
}

// ============================================================================
// MODULE STATE
// ============================================================================
let gl = null;
const meshes = {};   // 'left' | 'right' → mesh object

// ============================================================================
// GL / MATH HELPERS
// ============================================================================
function compile(src, type) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
        console.error('Hand shader compile:', gl.getShaderInfoLog(s));
    return s;
}

function mkProg(vs, fs) {
    const p = gl.createProgram();
    gl.attachShader(p, compile(vs, gl.VERTEX_SHADER));
    gl.attachShader(p, compile(fs, gl.FRAGMENT_SHADER));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS))
        console.error('Hand program link:', gl.getProgramInfoLog(p));
    return p;
}

// Column-major mat4 multiply: out[outOff..] = a * b
function mul4(out, outOff, a, b) {
    for (let c = 0; c < 4; c++)
        for (let r = 0; r < 4; r++) {
            let s = 0;
            for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
            out[outOff + c * 4 + r] = s;
        }
}

// ============================================================================
// GLB LOADER
// ============================================================================
async function loadMesh(side) {
    try {
        const buf = await fetch(CDN_BASE + side + '.glb').then(r => r.arrayBuffer());
        const dv  = new DataView(buf);

        const jsonLen  = dv.getUint32(12, true);
        const gltf     = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 20, jsonLen)));
        const binStart = 20 + jsonLen + 8;

        // Returns a typed array copy of an accessor's data (handles byteOffset + alignment)
        function getAcc(idx) {
            const acc = gltf.accessors[idx];
            const bv  = gltf.bufferViews[acc.bufferView];
            const COMP = { 5120:1, 5121:1, 5122:2, 5123:2, 5125:4, 5126:4 };
            const ELMS = { SCALAR:1, VEC2:2, VEC3:3, VEC4:4, MAT2:4, MAT3:9, MAT4:16 };
            const byteOff = binStart + (bv.byteOffset || 0) + (acc.byteOffset || 0);
            const byteLen = acc.count * ELMS[acc.type] * COMP[acc.componentType];
            const copy = new ArrayBuffer(byteLen);
            new Uint8Array(copy).set(new Uint8Array(buf, byteOff, byteLen));
            if (acc.componentType === 5126) return new Float32Array(copy);
            if (acc.componentType === 5121) return new Uint8Array(copy);
            if (acc.componentType === 5123) return new Uint16Array(copy);
            if (acc.componentType === 5125) return new Uint32Array(copy);
            return new Uint8Array(copy);
        }

        const prim   = gltf.meshes[0].primitives[0];
        const attrs  = prim.attributes;
        const idxAcc = gltf.accessors[prim.indices];

        const positions = getAcc(attrs.POSITION);
        const normals   = getAcc(attrs.NORMAL);
        const joints0   = getAcc(attrs.JOINTS_0);
        const weights0  = getAcc(attrs.WEIGHTS_0);
        const indices   = getAcc(prim.indices);
        const idxType   = idxAcc.componentType === 5125 ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT;

        const skin      = gltf.skins[0];
        const invBind   = getAcc(skin.inverseBindMatrices);
        const boneCount = skin.joints.length;

        // Map node names → bone indices, then XR joint index → bone index
        const boneByName = {};
        for (let i = 0; i < boneCount; i++)
            boneByName[gltf.nodes[skin.joints[i]].name] = i;

        const xrToBone = new Int32Array(JOINTS.length).fill(-1);
        for (let j = 0; j < JOINTS.length; j++)
            if (boneByName[JOINTS[j]] !== undefined) xrToBone[j] = boneByName[JOINTS[j]];

        console.log(`Hand model (${side}): ${boneCount} bones, ${xrToBone.filter(x => x >= 0).length}/${JOINTS.length} joints mapped`);

        const prog = mkProg(makeSkinVS(boneCount), SKIN_FS);
        if (!prog) return;

        const vao = gl.createVertexArray();
        gl.bindVertexArray(vao);

        function uploadBuf(data, target) {
            const b = gl.createBuffer();
            gl.bindBuffer(target, b);
            gl.bufferData(target, data, gl.STATIC_DRAW);
            return b;
        }
        function bindFloat(data, loc, size) {
            uploadBuf(data, gl.ARRAY_BUFFER);
            gl.enableVertexAttribArray(loc);
            gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
        }
        function bindInt(data, loc, size, type) {
            uploadBuf(data, gl.ARRAY_BUFFER);
            gl.enableVertexAttribArray(loc);
            gl.vertexAttribIPointer(loc, size, type, 0, 0);
        }

        const posLoc     = gl.getAttribLocation(prog, 'a_position');
        const normLoc    = gl.getAttribLocation(prog, 'a_normal');
        const jointsLoc  = gl.getAttribLocation(prog, 'a_joints');
        const weightsLoc = gl.getAttribLocation(prog, 'a_weights');

        if (posLoc     >= 0) bindFloat(positions, posLoc,    3);
        if (normLoc    >= 0) bindFloat(normals,   normLoc,   3);
        if (jointsLoc  >= 0) bindInt(joints0, jointsLoc, 4, gltf.accessors[attrs.JOINTS_0].componentType);
        if (weightsLoc >= 0) bindFloat(weights0,  weightsLoc, 4);

        uploadBuf(indices, gl.ELEMENT_ARRAY_BUFFER);
        gl.bindVertexArray(null);

        meshes[side] = { prog, vao, indexCount: idxAcc.count, idxType, invBind, boneCount, xrToBone };

    } catch (e) {
        console.error(`Failed to load hand model (${side}):`, e);
    }
}

// ============================================================================
// PER-FRAME DRAW
// ============================================================================
function drawMesh(src, mesh, frame, refSpace, proj, view) {
    const bm = new Float32Array(mesh.boneCount * 16);
    for (let i = 0; i < mesh.boneCount; i++)
        bm[i*16] = bm[i*16+5] = bm[i*16+10] = bm[i*16+15] = 1;  // identity

    for (let j = 0; j < JOINTS.length; j++) {
        const bi = mesh.xrToBone[j];
        if (bi < 0) continue;
        const joint = src.hand.get(JOINTS[j]);
        if (!joint) continue;
        const pose = frame.getJointPose(joint, refSpace);
        if (!pose) continue;
        mul4(bm, bi * 16, pose.transform.matrix, mesh.invBind.subarray(bi * 16, bi * 16 + 16));
    }

    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LESS);
    gl.disable(gl.BLEND);

    gl.useProgram(mesh.prog);
    gl.uniformMatrix4fv(gl.getUniformLocation(mesh.prog, 'u_projection'), false, proj);
    gl.uniformMatrix4fv(gl.getUniformLocation(mesh.prog, 'u_view'),       false, view);
    gl.uniformMatrix4fv(gl.getUniformLocation(mesh.prog, 'u_bones[0]'),   false, bm);
    gl.uniform3fv(gl.getUniformLocation(mesh.prog, 'u_color'),
        isHandPinching(src.handedness) ? COLOR_PINCHING : COLOR_DEFAULT);

    gl.bindVertexArray(mesh.vao);
    gl.drawElements(gl.TRIANGLES, mesh.indexCount, mesh.idxType, 0);
    gl.bindVertexArray(null);
}

// ============================================================================
// PUBLIC API — same signatures as renderHands.js, drop-in replacement
// ============================================================================
export function initHandRenderer(glContext) {
    gl = glContext;
    loadMesh('left');
    loadMesh('right');
    return true;
}

export function renderHands(_gl, frame, referenceSpace, projMatrix, viewMatrix) {
    if (!frame || !referenceSpace) return;
    for (const src of frame.session.inputSources) {
        if (!src.hand) continue;
        const mesh = meshes[src.handedness];
        if (!mesh) continue;   // still loading — nothing rendered until ready
        drawMesh(src, mesh, frame, referenceSpace, projMatrix, viewMatrix);
    }
}
