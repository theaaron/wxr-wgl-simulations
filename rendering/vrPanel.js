// vr control panel - grid + grab bar.

const _a = 25 * Math.PI / 180, _c = Math.cos(_a), _s = Math.sin(_a);
const PANEL = {
    position: [-0.5, 0.0, -0.6],
    width: 0.36,
    height: 0.30,
    backgroundColor: [0.0, 0.188, 0.341, 0.92],
    orientMatrix: new Float32Array([_c, 0, -_s, 0,  0, 1, 0, 0,  _s, 0, _c, 0,  0, 0, 0, 1]),
};

const LAYOUT = {
    padding: 0.04,
    gap: 0.02,
    barReserve: 0.10,
};

const BAR = {
    y: -0.46,
    width: 0.30,
    height: 0.035,
    color: [0.0, 0.28, 0.50],
    hoverColor: [0.0, 0.38, 0.65],
};

function generateButtons() {
    const p = LAYOUT.padding;
    const g = LAYOUT.gap;

    const left = -0.5 + p;
    const right = 0.5 - p;
    const top = 0.5 - p;
    const bottom = -0.5 + LAYOUT.barReserve + p;

    const cols = 3;
    const btnW = (right - left - (cols - 1) * g) / cols;
    const btnH = (top - bottom - 2 * g) / 3;  // 3-row layout

    const buttons = {};

    for (let r = 0; r < 2; r++) {
        for (let c = 0; c < cols; c++) {
            const x = left + c * (btnW + g) + btnW / 2;
            const y = top - r * (btnH + g) - btnH / 2;
            const isStart  = r === 0 && c === 0;
            const isExcite = r === 0 && c === 1;
            buttons[`btn_${r}_${c}`] = {
                x, y, width: btnW, height: btnH,
                color:      isStart ? [0.2, 0.4, 0.8] : [0.0, 0.32, 0.56],
                hoverColor: isStart ? [0.35, 0.55, 0.95] : [0.0, 0.45, 0.75],
                baseColor: [0.0, 0.32, 0.56],
                activeColor: [0.7, 0.35, 0.0],
                action: isStart  ? 'startSimulation'
                      : isExcite ? 'toggleExcitationMode'
                      : (r === 0 && c === 2) ? 'toggleAblationMode'
                      : (r === 1 && c === 0) ? 'exitVR'
                      : (r === 1 && c === 1) ? 'resetView'
                      : (r === 1 && c === 2) ? 'toggleHints'
                      : null,
            };
        }
    }

    const rowY  = top - 2 * (btnH + g) - btnH / 2;
    const fullW = right - left;
    const halfW = (fullW - g) / 2;

    buttons['btn_cut'] = {
        x: left + halfW / 2,
        y: rowY,
        width: halfW,
        height: btnH,
        color: [0.0, 0.32, 0.56],
        hoverColor: [0.0, 0.45, 0.75],
        baseColor: [0.0, 0.32, 0.56],
        activeColor: [0.7, 0.35, 0.0],
        action: 'toggleCut',
    };

    buttons['btn_sim'] = {
        x: left + halfW + g + halfW / 2,
        y: rowY,
        width: halfW,
        height: btnH,
        color: [0.0, 0.32, 0.56],
        hoverColor: [0.0, 0.45, 0.75],
        baseColor: [0.0, 0.32, 0.56],
        activeColor: [0.7, 0.35, 0.0],
        action: 'toggleSim',
    };

    return buttons;
}

const BUTTONS = generateButtons();

// ============================================================================
// STATE
// ============================================================================

let gl = null;
let panelProgram = null;
let buttonProgram = null;
let barProgram = null;
let textProgram = null;
let panelBuffer = null;
let panelIndexBuffer = null;
let buttonBuffer = null;
let buttonIndexBuffer = null;

const buttonLabels = {};
const buttonLabelTextures = {};

let hoveredButton = null;
let barHovered = false;
let simHovered = null;

let simStepsDisplay = 40;
const simPanelTextures = {};

let panelGrab = {
    active: false,
    hand: null,
    offset: [0, 0, 0],
    controllerMatrixAtGrab: null,
    orientAtGrab: null,
};

let prevGrabHeld = { left: false, right: false };

let callbacks = {};

let panelMode = 'normal';
let cutHovered = null;

const cutState = { x: 1.0, y: 1.0, z: 1.0 };
const CUT_MIN = 0.02;

const CUT_SLIDERS = [
    { id: 'x', label: 'X', bgColor: [0.45, 0.08, 0.08], fillColor: [0.85, 0.20, 0.20], handleColor: [1.00, 0.35, 0.35] },
    { id: 'y', label: 'Y', bgColor: [0.08, 0.40, 0.08], fillColor: [0.20, 0.80, 0.20], handleColor: [0.35, 1.00, 0.35] },
    { id: 'z', label: 'Z', bgColor: [0.08, 0.12, 0.50], fillColor: [0.20, 0.35, 0.90], handleColor: [0.35, 0.50, 1.00] },
];
const CUT_ITEM_H   = 0.19;
const CUT_ITEM_GAP = 0.02;
const CUT_TOP_Y    = 0.365;
const TRACK_X0     = -0.28;
const TRACK_X1     =  0.44;
const TRACK_SPAN   = TRACK_X1 - TRACK_X0;
const TRACK_H      = 0.025;
const HANDLE_W     = 0.04;
const HANDLE_H     = 0.12;
const LABEL_X      = -0.43;
const LABEL_W      = 0.07;
const LABEL_H      = CUT_ITEM_H * 0.65;

let cutPanelTextures = {};

// ---- Sim panel layout ----
const SIM_STEPS_Y =  0.28;
const SIM_BTNS_Y  =  0.04;
const SIM_BTN_W   =  0.34;
const SIM_BTN_H   =  0.22;
const SIM_DEC_X   = -0.20;
const SIM_INC_X   =  0.20;
const SIM_DONE_Y  = -0.24;
const SIM_DONE_W  =  0.72;
const SIM_DONE_H  =  0.18;

// ============================================================================
// SHADERS
// ============================================================================

const PANEL_VS = `#version 300 es
in vec3 a_position;
uniform mat4 u_projectionMatrix;
uniform mat4 u_viewMatrix;
uniform mat4 u_modelMatrix;

void main() {
    gl_Position = u_projectionMatrix * u_viewMatrix * u_modelMatrix * vec4(a_position, 1.0);
}
`;

const PANEL_FS = `#version 300 es
precision highp float;
uniform vec4 u_color;
out vec4 fragColor;

void main() {
    fragColor = u_color;
}
`;

const BUTTON_VS = `#version 300 es
in vec3 a_position;
uniform mat4 u_projectionMatrix;
uniform mat4 u_viewMatrix;
uniform mat4 u_modelMatrix;
uniform vec3 u_buttonOffset;
uniform vec2 u_buttonSize;

void main() {
    vec3 pos = a_position;
    pos.x = pos.x * u_buttonSize.x + u_buttonOffset.x;
    pos.y = pos.y * u_buttonSize.y + u_buttonOffset.y;
    pos.z = pos.z + u_buttonOffset.z + 0.001;
    gl_Position = u_projectionMatrix * u_viewMatrix * u_modelMatrix * vec4(pos, 1.0);
}
`;

const BUTTON_FS = `#version 300 es
precision highp float;
uniform vec3 u_buttonColor;
uniform float u_hover;
out vec4 fragColor;

void main() {
    vec3 color = u_buttonColor;
    if (u_hover > 0.5) {
        color = color * 1.3;
    }
    fragColor = vec4(color, 1.0);
}
`;

const BAR_VS = `#version 300 es
in vec3 a_position;
uniform mat4 u_projectionMatrix;
uniform mat4 u_viewMatrix;
uniform mat4 u_modelMatrix;
uniform vec3 u_barOffset;
uniform vec2 u_barSize;
out vec2 v_uv;

void main() {
    v_uv = a_position.xy + 0.5;
    vec3 pos = a_position;
    pos.x = pos.x * u_barSize.x + u_barOffset.x;
    pos.y = pos.y * u_barSize.y + u_barOffset.y;
    pos.z += 0.002;
    gl_Position = u_projectionMatrix * u_viewMatrix * u_modelMatrix * vec4(pos, 1.0);
}
`;

const BAR_FS = `#version 300 es
precision highp float;
uniform vec3 u_barColor;
uniform vec2 u_barSize;
in vec2 v_uv;
out vec4 fragColor;

void main() {
    vec2 p = (v_uv - 0.5) * u_barSize;
    float r = u_barSize.y * 0.5;
    float halfLen = max(u_barSize.x * 0.5 - r, 0.0);
    float d = length(vec2(max(abs(p.x) - halfLen, 0.0), p.y)) - r;
    if (d > 0.0) discard;
    float alpha = smoothstep(0.0, -0.001, d);
    fragColor = vec4(u_barColor, alpha * 0.9);
}
`;

const TEXT_VS = `#version 300 es
layout(location = 0) in vec3 a_position;
uniform mat4 u_projectionMatrix;
uniform mat4 u_viewMatrix;
uniform mat4 u_modelMatrix;
uniform vec3 u_offset;
uniform vec2 u_size;
out vec2 v_uv;

void main() {
    v_uv = vec2(a_position.x + 0.5, 0.5 - a_position.y);
    vec3 pos = a_position;
    pos.x = pos.x * u_size.x + u_offset.x;
    pos.y = pos.y * u_size.y + u_offset.y;
    pos.z += u_offset.z + 0.003;
    gl_Position = u_projectionMatrix * u_viewMatrix * u_modelMatrix * vec4(pos, 1.0);
}
`;

const TEXT_FS = `#version 300 es
precision mediump float;
uniform sampler2D u_texture;
in vec2 v_uv;
out vec4 fragColor;

void main() {
    vec4 c = texture(u_texture, v_uv);
    if (c.a < 0.05) discard;
    fragColor = c;
}
`;

// ============================================================================
// INITIALIZATION
// ============================================================================

export function initVRPanel(glContext) {
    gl = glContext;

    createQuadGeometry();
    panelProgram  = createProgram(PANEL_VS,  PANEL_FS,  'Panel');
    buttonProgram = createProgram(BUTTON_VS, BUTTON_FS, 'Button');
    barProgram    = createProgram(BAR_VS,    BAR_FS,    'Bar');
    textProgram   = createProgram(TEXT_VS,   TEXT_FS,   'Text');

    buttonLabels['btn_0_0'] = 'Solve';
    buttonLabels['btn_0_1'] = 'Excite';
    buttonLabels['btn_0_2'] = 'Ablate';
    buttonLabels['btn_1_0'] = 'Exit VR';
    buttonLabels['btn_1_1'] = 'Reset';
    buttonLabels['btn_1_2'] = 'Hide Hints';
    for (const [id, label] of Object.entries(buttonLabels)) {
        buttonLabelTextures[id] = createTextTexture(label);
    }

    buttonLabels['btn_cut'] = 'Cut';
    buttonLabelTextures['btn_cut'] = createTextTexture('Cut');
    buttonLabels['btn_sim'] = 'Sim Options';
    buttonLabelTextures['btn_sim'] = createTextTexture('Sim Options');
    cutPanelTextures.x_label  = createTextTexture('X',  128, 128);
    cutPanelTextures.y_label  = createTextTexture('Y',  128, 128);
    cutPanelTextures.z_label  = createTextTexture('Z',  128, 128);
    cutPanelTextures.done_btn = createTextTexture('Done');
    simPanelTextures.steps_label = createTextTexture(`${simStepsDisplay} steps`, 256, 128);
    simPanelTextures.decrement   = createTextTexture('−', 128, 128);
    simPanelTextures.increment   = createTextTexture('+', 128, 128);
    simPanelTextures.done        = createTextTexture('Done');

    if (panelProgram && buttonProgram && barProgram && textProgram) {
        console.log('VR Panel initialized');
        return true;
    }

    console.error('Failed to initialize VR Panel');
    return false;
}

function createQuadGeometry() {
    const vertices = new Float32Array([
        -0.5, -0.5, 0,
         0.5, -0.5, 0,
         0.5,  0.5, 0,
        -0.5,  0.5, 0
    ]);
    const indices = new Uint16Array([0, 1, 2, 0, 2, 3]);

    panelBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, panelBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

    panelIndexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, panelIndexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);

    buttonBuffer = panelBuffer;
    buttonIndexBuffer = panelIndexBuffer;
}

const TEXT_TEXTURE_ASPECT = 256 / 128;

function createTextTexture(text, w = 256, h = 128) {
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'white';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    let fontSize = Math.floor(h * 0.48);
    ctx.font = `bold ${fontSize}px sans-serif`;
    while (ctx.measureText(text).width > w * 0.92 && fontSize > 8) {
        fontSize -= 2;
        ctx.font = `bold ${fontSize}px sans-serif`;
    }
    ctx.fillText(text, w / 2, h / 2);

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

function createProgram(vsSource, fsSource, name) {
    const vs = compileShader(vsSource, gl.VERTEX_SHADER, name);
    const fs = compileShader(fsSource, gl.FRAGMENT_SHADER, name);
    if (!vs || !fs) return null;

    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        console.error(`${name} program link error:`, gl.getProgramInfoLog(program));
        return null;
    }
    return program;
}

function compileShader(source, type, name) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error(`${name} shader compile error:`, gl.getShaderInfoLog(shader));
        return null;
    }
    return shader;
}

// ============================================================================
// CALLBACKS
// ============================================================================

export function setPanelCallbacks(cbs) {
    for (const [key, fn] of Object.entries(cbs)) {
        if (typeof fn === 'function') callbacks[key] = fn;
    }
}

export function updateButtonLabel(id, text) {
    if (buttonLabelTextures[id]) gl.deleteTexture(buttonLabelTextures[id]);
    buttonLabels[id] = text;
    buttonLabelTextures[id] = createTextTexture(text);
}

export function getCutValues() {
    return { x: cutState.x, y: cutState.y, z: cutState.z };
}

export function updateSimStepsDisplay(n) {
    simStepsDisplay = n;
    if (gl && simPanelTextures.steps_label) {
        gl.deleteTexture(simPanelTextures.steps_label);
        simPanelTextures.steps_label = createTextTexture(`${n} steps`, 256, 128);
    }
}

export function setButtonActive(buttonId, active) {
    const btn = BUTTONS[buttonId];
    if (!btn) return;
    btn.color = active
        ? (btn.activeColor ?? [0.7, 0.35, 0.0])
        : (btn.baseColor   ?? [0.0, 0.32, 0.56]);
    btn.hoverColor = active
        ? [0.85, 0.50, 0.1]
        : [0.0,  0.45, 0.75];
}

// ============================================================================
// PANEL TRANSFORM
// ============================================================================

export function getPanelModelMatrix() {
    const pos = PANEL.position;
    const w = PANEL.width;
    const h = PANEL.height;
    const R = PANEL.orientMatrix;

    return new Float32Array([
        R[0]*w, R[1]*w, R[2]*w, 0,
        R[4]*h, R[5]*h, R[6]*h, 0,
        R[8]*w, R[9]*w, R[10]*w, 0,
        pos[0], pos[1], pos[2], 1
    ]);
}

// ============================================================================
// HIT TESTING 
// ============================================================================

function rayToLocal(origin, direction) {
    const modelMatrix = getPanelModelMatrix();
    const invModel = invertMatrix(modelMatrix);
    if (!invModel) return null;

    const localOrigin = transformPoint(invModel, [origin.x, origin.y, origin.z]);
    const localDir = transformDirection(invModel, [direction.x, direction.y, direction.z]);

    if (Math.abs(localDir[2]) < 0.0001) return null;

    const t = -localOrigin[2] / localDir[2];
    if (t < 0) return null;

    const hitX = localOrigin[0] + t * localDir[0];
    const hitY = localOrigin[1] + t * localDir[1];

    return { hitX, hitY, distance: t };
}

function pointToLocal(worldPos) {
    const modelMatrix = getPanelModelMatrix();
    const invModel = invertMatrix(modelMatrix);
    if (!invModel) return null;
    return transformPoint(invModel, [worldPos.x, worldPos.y, worldPos.z]);
}

function hitTestButton(hitX, hitY) {
    for (const [id, btn] of Object.entries(BUTTONS)) {
        if (hitX >= btn.x - btn.width / 2 && hitX <= btn.x + btn.width / 2 &&
            hitY >= btn.y - btn.height / 2 && hitY <= btn.y + btn.height / 2) {
            return id;
        }
    }
    return null;
}

function hitTestBar(hitX, hitY) {
    return Math.abs(hitX) <= BAR.width / 2 &&
           Math.abs(hitY - BAR.y) <= BAR.height / 2;
}

function hitTestTablet(hitX, hitY) {
    return Math.abs(hitX) <= 0.5 && Math.abs(hitY) <= 0.5;
}

export function rayHitsPanelTablet(origin, direction) {
    const hit = rayToLocal(origin, direction);
    if (!hit) return false;
    return hitTestTablet(hit.hitX, hit.hitY);
}

export function pinchMidpointTouchesPanelTablet(worldPos, maxDepthLocal = 0.12) {
    if (!worldPos) return false;
    const local = pointToLocal(worldPos);
    if (!local) return false;
    if (!hitTestTablet(local[0], local[1])) return false;
    return Math.abs(local[2]) <= maxDepthLocal;
}

// ============================================================================
// ray / poke intersection
// ============================================================================

export function rayIntersectsPanel(origin, direction) {
    const hit = rayToLocal(origin, direction);
    if (!hit) return null;

    if (Math.abs(hit.hitX) > 0.5 || Math.abs(hit.hitY) > 0.5) return null;

    const button = hitTestButton(hit.hitX, hit.hitY);

    const modelMatrix = getPanelModelMatrix();
    const worldHit = transformPoint(modelMatrix, [hit.hitX, hit.hitY, 0]);
    const dx = worldHit[0] - origin.x;
    const dy = worldHit[1] - origin.y;
    const dz = worldHit[2] - origin.z;
    const worldDistance = Math.sqrt(dx * dx + dy * dy + dz * dz);

    return { button, distance: worldDistance };
}

function sliderItemY(i) { return CUT_TOP_Y - i * (CUT_ITEM_H + CUT_ITEM_GAP); }

export function rayUpdateCutPanel(origin, direction) {
    if (panelMode !== 'cut') return false;
    const hit = rayToLocal(origin, direction);
    if (!hit || Math.abs(hit.hitX) > 0.5 || Math.abs(hit.hitY) > 0.5) return false;
    for (let i = 0; i < 3; i++) {
        if (Math.abs(hit.hitY - sliderItemY(i)) <= CUT_ITEM_H / 2) {
            const id = CUT_SLIDERS[i].id;
            cutState[id] = Math.max(CUT_MIN, Math.min(1.0, (hit.hitX - TRACK_X0) / TRACK_SPAN));
            return true;
        }
    }
    const doneY = sliderItemY(3);
    if (Math.abs(hit.hitY - doneY) <= CUT_ITEM_H / 2 && Math.abs(hit.hitX) <= 0.44)
        return 'done';
    return false;
}

function hitTestSimPanel(hitX, hitY) {
    if (Math.abs(hitX - SIM_DEC_X) <= SIM_BTN_W / 2 && Math.abs(hitY - SIM_BTNS_Y) <= SIM_BTN_H / 2)
        return 'btn_sim_decrement';
    if (Math.abs(hitX - SIM_INC_X) <= SIM_BTN_W / 2 && Math.abs(hitY - SIM_BTNS_Y) <= SIM_BTN_H / 2)
        return 'btn_sim_increment';
    if (Math.abs(hitX) <= SIM_DONE_W / 2 && Math.abs(hitY - SIM_DONE_Y) <= SIM_DONE_H / 2)
        return 'btn_done_sim';
    return null;
}

function hitTestCutPanel(hitX, hitY) {
    for (let i = 0; i < 3; i++) {
        if (Math.abs(hitY - sliderItemY(i)) <= CUT_ITEM_H / 2) {
            const id = CUT_SLIDERS[i].id;
            cutState[id] = Math.max(CUT_MIN, Math.min(1.0, (hitX - TRACK_X0) / TRACK_SPAN));
            return 'slider_' + id;
        }
    }
    const doneY = sliderItemY(3);
    if (Math.abs(hitY - doneY) <= CUT_ITEM_H / 2 && Math.abs(hitX) <= 0.44)
        return 'btn_done_cut';
    return null;
}

export function fingerPokePanel(fingerTipPos) {
    const local = pointToLocal(fingerTipPos);
    if (!local) return null;
    if (Math.abs(local[2]) > 0.06) return null;
    if (Math.abs(local[0]) > 0.5 || Math.abs(local[1]) > 0.5) return null;

    if (panelMode === 'cut') return hitTestCutPanel(local[0], local[1]);
    if (panelMode === 'sim') return hitTestSimPanel(local[0], local[1]);
    return hitTestButton(local[0], local[1]);
}

// ============================================================================
// PANEL HOVER (buttons + bar)
// ============================================================================

export function updatePanelHover(leftController, rightController) {
    hoveredButton = null;
    barHovered = false;
    cutHovered = null;
    simHovered = null;

    const controllers = [leftController, rightController].filter(Boolean);
    for (const ctrl of controllers) {
        const hit = rayToLocal(ctrl.origin, ctrl.direction);
        if (!hit || Math.abs(hit.hitX) > 0.55 || Math.abs(hit.hitY) > 0.6) continue;

        if (panelMode === 'cut') {
            const doneY = sliderItemY(3);
            if (Math.abs(hit.hitY - doneY) <= CUT_ITEM_H / 2 && Math.abs(hit.hitX) <= 0.44) {
                cutHovered = 'done';
                return;
            }
        } else if (panelMode === 'sim') {
            const sh = hitTestSimPanel(hit.hitX, hit.hitY);
            if (sh) { simHovered = sh; return; }
        } else {
            const btn = hitTestButton(hit.hitX, hit.hitY);
            if (btn) { hoveredButton = btn; return; }
        }

        if (hitTestBar(hit.hitX, hit.hitY)) { barHovered = true; return; }
    }
}

// ============================================================================
// BUTTON TRIGGER
// ============================================================================

export function triggerPanelButton(buttonId) {
    const id = buttonId || hoveredButton || simHovered;
    if (!id) return false;

    if (id === 'btn_done_cut') {
        panelMode = 'normal';
        setButtonActive('btn_cut', false);
        return true;
    }

    if (id === 'btn_done_sim') {
        panelMode = 'normal';
        setButtonActive('btn_sim', false);
        return true;
    }

    if (id === 'btn_sim_decrement') {
        if (callbacks.changeSteps) callbacks.changeSteps(-5);
        return true;
    }

    if (id === 'btn_sim_increment') {
        if (callbacks.changeSteps) callbacks.changeSteps(+5);
        return true;
    }

    if (!BUTTONS[id]) return false;
    const action = BUTTONS[id].action;
    console.log(`Panel button triggered: ${id}, action=${action}, registered=${!!callbacks[action]}`);

    if (action === 'toggleCut') {
        panelMode = 'cut';
        setButtonActive('btn_cut', true);
        return true;
    }

    if (action === 'toggleSim') {
        panelMode = 'sim';
        setButtonActive('btn_sim', true);
        return true;
    }

    if (action && callbacks[action]) {
        callbacks[action]();
        return true;
    }
    return false;
}

export function isHoveringPanel() {
    return hoveredButton !== null || simHovered !== null;
}

export function getHoveredButton() {
    return hoveredButton;
}

export function isBarHovered() {
    return barHovered;
}

// ============================================================================
// PANEL GRAB: controller grip (aiming at full tablet) or hand pinch when midpoint is on the tablet
// ============================================================================

function pinchAnchorWorld(leftPinchWorld, rightPinchWorld, hand) {
    return hand === 'left' ? leftPinchWorld : rightPinchWorld;
}

export function updatePanelGrab(
    leftCtrl, rightCtrl,
    leftSqueezing, rightSqueezing,
    leftPinching, rightPinching,
    pinchWorldLeft = null,
    pinchWorldRight = null
) {
    const wasGrabHeld = { left: prevGrabHeld.left, right: prevGrabHeld.right };
    prevGrabHeld.left = leftSqueezing || leftPinching;
    prevGrabHeld.right = rightSqueezing || rightPinching;

    if (panelGrab.active) {
        const hand = panelGrab.hand;
        const ctrl = hand === 'left' ? leftCtrl : rightCtrl;
        const pinch = pinchAnchorWorld(pinchWorldLeft, pinchWorldRight, hand);
        const stillHolding = hand === 'left'
            ? (leftSqueezing || leftPinching)
            : (rightSqueezing || rightPinching);

        if (!stillHolding || !ctrl) {
            panelGrab.active = false;
            panelGrab.hand = null;
            return;
        }

        const pinchMove = !!(ctrl.isHand && (hand === 'left' ? leftPinching : rightPinching) && pinch);
        const ox = pinchMove ? pinch.x : ctrl.origin.x;
        const oy = pinchMove ? pinch.y : ctrl.origin.y;
        const oz = pinchMove ? pinch.z : ctrl.origin.z;

        PANEL.position = [
            ox + panelGrab.offset[0],
            oy + panelGrab.offset[1],
            oz + panelGrab.offset[2],
        ];

        if (ctrl.matrix && panelGrab.controllerMatrixAtGrab && panelGrab.orientAtGrab) {
            const delta = multiplyMat4(ctrl.matrix, invertMatrix(panelGrab.controllerMatrixAtGrab));
            PANEL.orientMatrix = multiplyMat4(extractRotation(delta), panelGrab.orientAtGrab);
        }
        return;
    }

    const candidates = [
        { hand: 'left', ctrl: leftCtrl, squeezing: leftSqueezing, pinching: leftPinching, pinch: pinchWorldLeft, isNewGrab: (leftSqueezing || leftPinching) && !wasGrabHeld.left },
        { hand: 'right', ctrl: rightCtrl, squeezing: rightSqueezing, pinching: rightPinching, pinch: pinchWorldRight, isNewGrab: (rightSqueezing || rightPinching) && !wasGrabHeld.right },
    ];

    for (const c of candidates) {
        if (!c.ctrl || !c.isNewGrab) continue;

        let onTablet = false;
        let grabAnchor = c.ctrl.origin;

        if (c.squeezing && !c.ctrl.isHand) {
            const hit = rayToLocal(c.ctrl.origin, c.ctrl.direction);
            if (hit && (hitTestBar(hit.hitX, hit.hitY) || hitTestTablet(hit.hitX, hit.hitY))) {
                onTablet = true;
                grabAnchor = c.ctrl.origin;
            }
        }

        if (!onTablet && c.pinching && c.pinch &&
            pinchMidpointTouchesPanelTablet(c.pinch)) {
            const lp = pointToLocal(c.pinch);
            const inSliderArea = panelMode === 'cut' && lp &&
                lp[1] > sliderItemY(3) - CUT_ITEM_H / 2;
            if (!inSliderArea) {
                onTablet = true;
                grabAnchor = c.pinch;
            }
        }

        if (onTablet) {
            panelGrab.active = true;
            panelGrab.hand = c.hand;
            panelGrab.offset = [
                PANEL.position[0] - grabAnchor.x,
                PANEL.position[1] - grabAnchor.y,
                PANEL.position[2] - grabAnchor.z,
            ];
            panelGrab.controllerMatrixAtGrab = new Float32Array(c.ctrl.matrix);
            panelGrab.orientAtGrab = new Float32Array(PANEL.orientMatrix);
            return;
        }
    }
}

export function isPanelGrabbed() {
    return panelGrab.active;
}

// ============================================================================
// RENDERING
// ============================================================================

export function renderVRPanel(projectionMatrix, viewMatrix) {
    if (!panelProgram || !buttonProgram || !barProgram) return;

    const modelMatrix = getPanelModelMatrix();

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LESS);

    gl.useProgram(panelProgram);
    gl.uniformMatrix4fv(gl.getUniformLocation(panelProgram, 'u_projectionMatrix'), false, projectionMatrix);
    gl.uniformMatrix4fv(gl.getUniformLocation(panelProgram, 'u_viewMatrix'), false, viewMatrix);
    gl.uniformMatrix4fv(gl.getUniformLocation(panelProgram, 'u_modelMatrix'), false, modelMatrix);
    gl.uniform4fv(gl.getUniformLocation(panelProgram, 'u_color'), PANEL.backgroundColor);

    bindQuad(panelProgram);
    gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);

    if (panelMode === 'normal') {
        gl.useProgram(buttonProgram);
        gl.uniformMatrix4fv(gl.getUniformLocation(buttonProgram, 'u_projectionMatrix'), false, projectionMatrix);
        gl.uniformMatrix4fv(gl.getUniformLocation(buttonProgram, 'u_viewMatrix'), false, viewMatrix);
        gl.uniformMatrix4fv(gl.getUniformLocation(buttonProgram, 'u_modelMatrix'), false, modelMatrix);
        bindQuad(buttonProgram);

        for (const [id, btn] of Object.entries(BUTTONS)) {
            const isHov = hoveredButton === id;
            const color = isHov ? btn.hoverColor : btn.color;
            gl.uniform3fv(gl.getUniformLocation(buttonProgram, 'u_buttonOffset'), [btn.x, btn.y, 0]);
            gl.uniform2fv(gl.getUniformLocation(buttonProgram, 'u_buttonSize'), [btn.width, btn.height]);
            gl.uniform3fv(gl.getUniformLocation(buttonProgram, 'u_buttonColor'), color);
            gl.uniform1f(gl.getUniformLocation(buttonProgram, 'u_hover'), isHov ? 1.0 : 0.0);
            gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
        }

        if (textProgram) {
            gl.useProgram(textProgram);
            gl.uniformMatrix4fv(gl.getUniformLocation(textProgram, 'u_projectionMatrix'), false, projectionMatrix);
            gl.uniformMatrix4fv(gl.getUniformLocation(textProgram, 'u_viewMatrix'), false, viewMatrix);
            gl.uniformMatrix4fv(gl.getUniformLocation(textProgram, 'u_modelMatrix'), false, modelMatrix);
            gl.activeTexture(gl.TEXTURE0);
            gl.uniform1i(gl.getUniformLocation(textProgram, 'u_texture'), 0);
            bindQuad(textProgram);
            for (const [id, tex] of Object.entries(buttonLabelTextures)) {
                const btn = BUTTONS[id];
                if (!btn) continue;
                gl.bindTexture(gl.TEXTURE_2D, tex);
                gl.uniform3fv(gl.getUniformLocation(textProgram, 'u_offset'), [btn.x, btn.y, 0]);

                const maxW = btn.width * 0.85;
                const maxH = btn.height * 0.55;
                let textH = maxH;
                let textW = textH * TEXT_TEXTURE_ASPECT;
                if (textW > maxW) { textW = maxW; textH = textW / TEXT_TEXTURE_ASPECT; }
                gl.uniform2fv(gl.getUniformLocation(textProgram, 'u_size'), [textW, textH]);
                gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
            }
            gl.bindTexture(gl.TEXTURE_2D, null);
        }
    } else if (panelMode === 'sim') {
        renderSimPanel(projectionMatrix, viewMatrix, modelMatrix);
    } else {
        renderCutPanel(projectionMatrix, viewMatrix, modelMatrix);
    }

    // grab bar (capsule / pill)
    gl.useProgram(barProgram);
    gl.uniformMatrix4fv(gl.getUniformLocation(barProgram, 'u_projectionMatrix'), false, projectionMatrix);
    gl.uniformMatrix4fv(gl.getUniformLocation(barProgram, 'u_viewMatrix'), false, viewMatrix);
    gl.uniformMatrix4fv(gl.getUniformLocation(barProgram, 'u_modelMatrix'), false, modelMatrix);

    const barColor = barHovered || panelGrab.active ? BAR.hoverColor : BAR.color;
    gl.uniform3fv(gl.getUniformLocation(barProgram, 'u_barColor'), barColor);
    gl.uniform3fv(gl.getUniformLocation(barProgram, 'u_barOffset'), [0, BAR.y, 0]);
    gl.uniform2fv(gl.getUniformLocation(barProgram, 'u_barSize'), [BAR.width, BAR.height]);

    bindQuad(barProgram);
    gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);

    gl.disable(gl.BLEND);
}

function renderCutPanel(projMatrix, viewMatrix, modelMatrix) {
    const DONE_Y = sliderItemY(3);
    const trackCenterX = (TRACK_X0 + TRACK_X1) / 2;

    gl.useProgram(buttonProgram);
    gl.uniformMatrix4fv(gl.getUniformLocation(buttonProgram, 'u_projectionMatrix'), false, projMatrix);
    gl.uniformMatrix4fv(gl.getUniformLocation(buttonProgram, 'u_viewMatrix'), false, viewMatrix);
    gl.uniformMatrix4fv(gl.getUniformLocation(buttonProgram, 'u_modelMatrix'), false, modelMatrix);
    gl.uniform1f(gl.getUniformLocation(buttonProgram, 'u_hover'), 0);
    bindQuad(buttonProgram);

    for (let i = 0; i < 3; i++) {
        const sl  = CUT_SLIDERS[i];
        const sy  = sliderItemY(i);
        const val = cutState[sl.id];
        const fillW   = val * TRACK_SPAN;
        const handleX = TRACK_X0 + val * TRACK_SPAN;

        gl.uniform3fv(gl.getUniformLocation(buttonProgram, 'u_buttonOffset'), [trackCenterX, sy, 0]);
        gl.uniform2fv(gl.getUniformLocation(buttonProgram, 'u_buttonSize'), [TRACK_SPAN, TRACK_H]);
        gl.uniform3fv(gl.getUniformLocation(buttonProgram, 'u_buttonColor'), sl.bgColor);
        gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);

        if (fillW > 0.001) {
            gl.uniform3fv(gl.getUniformLocation(buttonProgram, 'u_buttonOffset'), [TRACK_X0 + fillW / 2, sy, 0.0005]);
            gl.uniform2fv(gl.getUniformLocation(buttonProgram, 'u_buttonSize'), [fillW, TRACK_H]);
            gl.uniform3fv(gl.getUniformLocation(buttonProgram, 'u_buttonColor'), sl.fillColor);
            gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
        }

        gl.uniform3fv(gl.getUniformLocation(buttonProgram, 'u_buttonOffset'), [handleX, sy, 0.001]);
        gl.uniform2fv(gl.getUniformLocation(buttonProgram, 'u_buttonSize'), [HANDLE_W, HANDLE_H]);
        gl.uniform3fv(gl.getUniformLocation(buttonProgram, 'u_buttonColor'), sl.handleColor);
        gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
    }

    const doneColor = cutHovered === 'done' ? [0.0, 0.45, 0.75] : [0.0, 0.32, 0.56];
    gl.uniform3fv(gl.getUniformLocation(buttonProgram, 'u_buttonOffset'), [0, DONE_Y, 0]);
    gl.uniform2fv(gl.getUniformLocation(buttonProgram, 'u_buttonSize'), [TRACK_SPAN + 0.04, CUT_ITEM_H * 0.85]);
    gl.uniform3fv(gl.getUniformLocation(buttonProgram, 'u_buttonColor'), doneColor);
    gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);

    if (textProgram) {
        gl.useProgram(textProgram);
        gl.uniformMatrix4fv(gl.getUniformLocation(textProgram, 'u_projectionMatrix'), false, projMatrix);
        gl.uniformMatrix4fv(gl.getUniformLocation(textProgram, 'u_viewMatrix'), false, viewMatrix);
        gl.uniformMatrix4fv(gl.getUniformLocation(textProgram, 'u_modelMatrix'), false, modelMatrix);
        gl.activeTexture(gl.TEXTURE0);
        gl.uniform1i(gl.getUniformLocation(textProgram, 'u_texture'), 0);
        bindQuad(textProgram);

        const ac = PANEL.height / PANEL.width;

        const labelKeys = ['x_label', 'y_label', 'z_label'];
        for (let i = 0; i < 3; i++) {
            const tex = cutPanelTextures[labelKeys[i]];
            if (!tex) continue;
            gl.bindTexture(gl.TEXTURE_2D, tex);
            gl.uniform3fv(gl.getUniformLocation(textProgram, 'u_offset'), [LABEL_X, sliderItemY(i), 0]);
            gl.uniform2fv(gl.getUniformLocation(textProgram, 'u_size'), [LABEL_H * ac, LABEL_H]);
            gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
        }

        const doneTex = cutPanelTextures.done_btn;
        if (doneTex) {
            const doneH = CUT_ITEM_H * 0.55;
            gl.bindTexture(gl.TEXTURE_2D, doneTex);
            gl.uniform3fv(gl.getUniformLocation(textProgram, 'u_offset'), [0, DONE_Y, 0]);
            gl.uniform2fv(gl.getUniformLocation(textProgram, 'u_size'), [doneH * 2 * ac, doneH]);
            gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
        }
        gl.bindTexture(gl.TEXTURE_2D, null);
    }
}

function renderSimPanel(projMatrix, viewMatrix, modelMatrix) {
    gl.useProgram(buttonProgram);
    gl.uniformMatrix4fv(gl.getUniformLocation(buttonProgram, 'u_projectionMatrix'), false, projMatrix);
    gl.uniformMatrix4fv(gl.getUniformLocation(buttonProgram, 'u_viewMatrix'), false, viewMatrix);
    gl.uniformMatrix4fv(gl.getUniformLocation(buttonProgram, 'u_modelMatrix'), false, modelMatrix);
    gl.uniform1f(gl.getUniformLocation(buttonProgram, 'u_hover'), 0);
    bindQuad(buttonProgram);

    const decColor  = simHovered === 'btn_sim_decrement' ? [0.0, 0.45, 0.75] : [0.0, 0.32, 0.56];
    const incColor  = simHovered === 'btn_sim_increment' ? [0.0, 0.45, 0.75] : [0.0, 0.32, 0.56];
    const doneColor = simHovered === 'btn_done_sim'      ? [0.0, 0.45, 0.75] : [0.0, 0.32, 0.56];

    gl.uniform3fv(gl.getUniformLocation(buttonProgram, 'u_buttonOffset'), [SIM_DEC_X, SIM_BTNS_Y, 0]);
    gl.uniform2fv(gl.getUniformLocation(buttonProgram, 'u_buttonSize'), [SIM_BTN_W, SIM_BTN_H]);
    gl.uniform3fv(gl.getUniformLocation(buttonProgram, 'u_buttonColor'), decColor);
    gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);

    gl.uniform3fv(gl.getUniformLocation(buttonProgram, 'u_buttonOffset'), [SIM_INC_X, SIM_BTNS_Y, 0]);
    gl.uniform2fv(gl.getUniformLocation(buttonProgram, 'u_buttonSize'), [SIM_BTN_W, SIM_BTN_H]);
    gl.uniform3fv(gl.getUniformLocation(buttonProgram, 'u_buttonColor'), incColor);
    gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);

    gl.uniform3fv(gl.getUniformLocation(buttonProgram, 'u_buttonOffset'), [0, SIM_DONE_Y, 0]);
    gl.uniform2fv(gl.getUniformLocation(buttonProgram, 'u_buttonSize'), [SIM_DONE_W, SIM_DONE_H]);
    gl.uniform3fv(gl.getUniformLocation(buttonProgram, 'u_buttonColor'), doneColor);
    gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);

    if (!textProgram) return;
    gl.useProgram(textProgram);
    gl.uniformMatrix4fv(gl.getUniformLocation(textProgram, 'u_projectionMatrix'), false, projMatrix);
    gl.uniformMatrix4fv(gl.getUniformLocation(textProgram, 'u_viewMatrix'), false, viewMatrix);
    gl.uniformMatrix4fv(gl.getUniformLocation(textProgram, 'u_modelMatrix'), false, modelMatrix);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1i(gl.getUniformLocation(textProgram, 'u_texture'), 0);
    bindQuad(textProgram);

    const ac = PANEL.height / PANEL.width;

    if (simPanelTextures.steps_label) {
        gl.bindTexture(gl.TEXTURE_2D, simPanelTextures.steps_label);
        gl.uniform3fv(gl.getUniformLocation(textProgram, 'u_offset'), [0, SIM_STEPS_Y, 0]);
        gl.uniform2fv(gl.getUniformLocation(textProgram, 'u_size'), [0.50, 0.12]);
        gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
    }

    if (simPanelTextures.decrement) {
        gl.bindTexture(gl.TEXTURE_2D, simPanelTextures.decrement);
        gl.uniform3fv(gl.getUniformLocation(textProgram, 'u_offset'), [SIM_DEC_X, SIM_BTNS_Y, 0]);
        const h = SIM_BTN_H * 0.65;
        gl.uniform2fv(gl.getUniformLocation(textProgram, 'u_size'), [h * ac, h]);
        gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
    }

    if (simPanelTextures.increment) {
        gl.bindTexture(gl.TEXTURE_2D, simPanelTextures.increment);
        gl.uniform3fv(gl.getUniformLocation(textProgram, 'u_offset'), [SIM_INC_X, SIM_BTNS_Y, 0]);
        const h = SIM_BTN_H * 0.65;
        gl.uniform2fv(gl.getUniformLocation(textProgram, 'u_size'), [h * ac, h]);
        gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
    }

    if (simPanelTextures.done) {
        gl.bindTexture(gl.TEXTURE_2D, simPanelTextures.done);
        gl.uniform3fv(gl.getUniformLocation(textProgram, 'u_offset'), [0, SIM_DONE_Y, 0]);
        const h = SIM_DONE_H * 0.60;
        gl.uniform2fv(gl.getUniformLocation(textProgram, 'u_size'), [h * 2 * ac, h]);
        gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
    }

    gl.bindTexture(gl.TEXTURE_2D, null);
}

function bindQuad(program) {
    const posLoc = gl.getAttribLocation(program, 'a_position');
    gl.bindBuffer(gl.ARRAY_BUFFER, panelBuffer);
    gl.vertexAttribPointer(posLoc, 3, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(posLoc);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, panelIndexBuffer);
}

// ============================================================================
// MATRIX UTILITIES
// ============================================================================

function invertMatrix(m) {
    const out = new Float32Array(16);
    const a00 = m[0], a01 = m[1], a02 = m[2], a03 = m[3];
    const a10 = m[4], a11 = m[5], a12 = m[6], a13 = m[7];
    const a20 = m[8], a21 = m[9], a22 = m[10], a23 = m[11];
    const a30 = m[12], a31 = m[13], a32 = m[14], a33 = m[15];

    const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10;
    const b02 = a00 * a13 - a03 * a10, b03 = a01 * a12 - a02 * a11;
    const b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12;
    const b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30;
    const b08 = a20 * a33 - a23 * a30, b09 = a21 * a32 - a22 * a31;
    const b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;

    let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
    if (!det) return null;
    det = 1.0 / det;

    out[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det;
    out[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
    out[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det;
    out[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
    out[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det;
    out[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
    out[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det;
    out[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
    out[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det;
    out[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
    out[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det;
    out[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
    out[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det;
    out[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
    out[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det;
    out[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;

    return out;
}

function transformPoint(m, v) {
    const x = v[0], y = v[1], z = v[2];
    const w = m[3] * x + m[7] * y + m[11] * z + m[15] || 1.0;
    return [
        (m[0] * x + m[4] * y + m[8] * z + m[12]) / w,
        (m[1] * x + m[5] * y + m[9] * z + m[13]) / w,
        (m[2] * x + m[6] * y + m[10] * z + m[14]) / w
    ];
}

function multiplyMat4(a, b) {
    const out = new Float32Array(16);
    for (let col = 0; col < 4; col++)
        for (let row = 0; row < 4; row++) {
            let v = 0;
            for (let k = 0; k < 4; k++) v += a[k*4+row] * b[col*4+k];
            out[col*4+row] = v;
        }
    return out;
}

function extractRotation(m) {
    const out = new Float32Array(16);
    for (let col = 0; col < 3; col++) {
        const x = m[col*4], y = m[col*4+1], z = m[col*4+2];
        const len = Math.sqrt(x*x + y*y + z*z) || 1;
        out[col*4] = x/len; out[col*4+1] = y/len; out[col*4+2] = z/len;
    }
    out[15] = 1;
    return out;
}

function transformDirection(m, v) {
    const x = v[0], y = v[1], z = v[2];
    return [
        m[0] * x + m[4] * y + m[8] * z,
        m[1] * x + m[5] * y + m[9] * z,
        m[2] * x + m[6] * y + m[10] * z
    ];
}
