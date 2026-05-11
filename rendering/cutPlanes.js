import { isHandPinching, getHandPinchWorldPoint } from './handTracking.js';
import { isControllerSqueezing, getLeftController, getRightController } from './vrControllers.js';

// ============================================================================
// CONSTANTS
// ============================================================================
const GRAB_RADIUS = 0.08;
const CUT_MIN     = 0.02;
const CUT_MAX     = 1.0;
const HANDLE_FRAC = 0.38;

const AXES = [
    { key: 'x', col: 0, planeRGBA: [0.9, 0.12, 0.12, 0.18], handleRGBA: [1.0, 0.35, 0.35, 0.88] },
    { key: 'y', col: 1, planeRGBA: [0.12, 0.9, 0.12, 0.18], handleRGBA: [0.35, 1.0, 0.35, 0.88] },
    { key: 'z', col: 2, planeRGBA: [0.12, 0.12, 0.9, 0.18], handleRGBA: [0.35, 0.35, 1.0, 0.88] },
];

// ============================================================================
// SHADERS
// ============================================================================
const VS = `#version 300 es
in vec2 a_quad;
uniform mat4 u_proj;
uniform mat4 u_view;
uniform vec3 u_center;
uniform vec3 u_right;
uniform vec3 u_up;
void main() {
    vec3 p = u_center + a_quad.x * u_right + a_quad.y * u_up;
    gl_Position = u_proj * u_view * vec4(p, 1.0);
}`;

const FS = `#version 300 es
precision mediump float;
uniform vec4 u_color;
out vec4 fragColor;
void main() { fragColor = u_color; }`;

// ============================================================================
// MODULE STATE
// ============================================================================
let gl  = null;
let prog    = null;
let quadVBO = null;

let currentModelMatrix = null;

const cutState = { x: 1.0, y: 1.0, z: 1.0 };

const grab = {
    axis: null,
    axisCol: -1,
    hand: null,
    isController: false,
    initialPinch: null, 
    initialCut: 1.0,
};

// ============================================================================
// MATH HELPERS
// ============================================================================
function col3(M, c) { return [M[c*4], M[c*4+1], M[c*4+2]]; }
function sub3(a, b) { return [a[0]-b[0], a[1]-b[1], a[2]-b[2]]; }
function dot3(a, b) { return a[0]*b[0] + a[1]*b[1] + a[2]*b[2]; }
function len3(v)    { return Math.sqrt(v[0]*v[0] + v[1]*v[1] + v[2]*v[2]); }

function planeCenterWorld(M, axisCol, cutVal) {
    const t = (cutVal - 0.5) * 2.0;   // [0,1] → [-1,1] model space
    const c = col3(M, axisCol);
    return [c[0]*t + M[12], c[1]*t + M[13], c[2]*t + M[14]];
}

function planeTangents(M, axisCol) {
    const [t1, t2] = [0, 1, 2].filter(i => i !== axisCol);
    return { right: col3(M, t1), up: col3(M, t2) };
}

// ============================================================================
// GL HELPERS
// ============================================================================
function compileShader(src, type) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
        console.error('cutPlanes shader:', gl.getShaderInfoLog(s));
    return s;
}

// ============================================================================
// PUBLIC API
// ============================================================================

export function initCutPlanes(glCtx) {
    gl = glCtx;

    const p = gl.createProgram();
    gl.attachShader(p, compileShader(VS, gl.VERTEX_SHADER));
    gl.attachShader(p, compileShader(FS, gl.FRAGMENT_SHADER));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS))
        console.error('cutPlanes link:', gl.getProgramInfoLog(p));
    prog = p;

    quadVBO = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quadVBO);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, 1,1, -1,1]), gl.STATIC_DRAW);
}

function getGripPos(hand, isController) {
    if (isController) {
        const ctrl = hand === 'left' ? getLeftController() : getRightController();
        if (!ctrl) return null;
        return [ctrl.origin.x, ctrl.origin.y, ctrl.origin.z];
    }
    const p = getHandPinchWorldPoint(hand);
    return p ? [p.x, p.y, p.z] : null;
}

export function checkCutPlaneGrab(hand, worldPos = null) {
    if (!currentModelMatrix) return false;
    const isController = worldPos !== null;
    const pw = worldPos ?? (() => {
        const p = getHandPinchWorldPoint(hand);
        return p ? [p.x, p.y, p.z] : null;
    })();
    if (!pw) return false;
    for (const { key, col } of AXES) {
        const center = planeCenterWorld(currentModelMatrix, col, cutState[key]);
        if (len3(sub3(pw, center)) < GRAB_RADIUS) {
            grab.axis = key;  grab.axisCol = col;  grab.hand = hand;
            grab.isController = isController;
            grab.initialPinch = pw;  grab.initialCut = cutState[key];
            return true;
        }
    }
    return false;
}

export function updateCutPlanes(structModelMatrix) {
    currentModelMatrix = structModelMatrix;

    if (!grab.axis) return;

    const active = grab.isController
        ? isControllerSqueezing(grab.hand)
        : isHandPinching(grab.hand);
    if (!active) { grab.axis = null; return; }

    const pw = getGripPos(grab.hand, grab.isController);
    if (!pw || !structModelMatrix) return;
    const M = structModelMatrix;

    const dp       = sub3(pw, grab.initialPinch);
    const axisVec  = col3(M, grab.axisCol);
    const scale    = len3(axisVec);
    const projDisp = dot3(dp, axisVec) / scale;
    const deltaCut = projDisp / (2.0 * scale);
    cutState[grab.axis] = Math.max(CUT_MIN, Math.min(CUT_MAX, grab.initialCut + deltaCut));
}

export function getCutValues() {
    return { x: cutState.x, y: cutState.y, z: cutState.z };
}

export function renderCutPlanes(projMatrix, viewMatrix, structModelMatrix) {
    if (!prog || !quadVBO || !structModelMatrix) return;
    const M     = structModelMatrix;
    const scale = len3(col3(M, 0));
    if (scale < 0.001) return;

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(false);

    gl.useProgram(prog);

    const quadLoc   = gl.getAttribLocation(prog,  'a_quad');
    const projLoc   = gl.getUniformLocation(prog, 'u_proj');
    const viewLoc   = gl.getUniformLocation(prog, 'u_view');
    const centerLoc = gl.getUniformLocation(prog, 'u_center');
    const rightLoc  = gl.getUniformLocation(prog, 'u_right');
    const upLoc     = gl.getUniformLocation(prog, 'u_up');
    const colorLoc  = gl.getUniformLocation(prog, 'u_color');

    gl.bindBuffer(gl.ARRAY_BUFFER, quadVBO);
    gl.enableVertexAttribArray(quadLoc);
    gl.vertexAttribPointer(quadLoc, 2, gl.FLOAT, false, 0, 0);

    gl.uniformMatrix4fv(projLoc, false, projMatrix);
    gl.uniformMatrix4fv(viewLoc, false, viewMatrix);

    for (const { key, col, planeRGBA, handleRGBA } of AXES) {
        const cutVal    = cutState[key];
        const isGrabbed = grab.axis === key;
        const center    = planeCenterWorld(M, col, cutVal);
        const { right, up } = planeTangents(M, col);

        gl.uniform3fv(centerLoc, center);
        gl.uniform3fv(rightLoc,  right);
        gl.uniform3fv(upLoc,     up);
        gl.uniform4fv(colorLoc,  isGrabbed ? [planeRGBA[0], planeRGBA[1], planeRGBA[2], 0.35] : planeRGBA);
        gl.drawArrays(gl.TRIANGLE_FAN, 0, 4);

        const hHalf     = scale * HANDLE_FRAC;
        const hRight    = right.map(v => v / scale * hHalf);
        const hUp       = up.map(v => v / scale * hHalf);
        gl.uniform3fv(rightLoc,  hRight);
        gl.uniform3fv(upLoc,     hUp);
        gl.uniform4fv(colorLoc,  isGrabbed ? [1.0, 1.0, 0.25, 0.95] : handleRGBA);
        gl.drawArrays(gl.TRIANGLE_FAN, 0, 4);
    }

    gl.depthMask(true);
    gl.disable(gl.BLEND);
    gl.disableVertexAttribArray(quadLoc);
}
