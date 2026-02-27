// vr control panel — 3x3 grid + grab bar

const PANEL = {
    position: [-0.5, 0.0, -0.6],
    width: 0.36,
    height: 0.30,
    rotation: 25 * Math.PI / 180,
    backgroundColor: [0.12, 0.12, 0.16, 0.9],
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
    color: [0.45, 0.45, 0.50],
    hoverColor: [0.65, 0.65, 0.70],
};

function generateButtons() {
    const p = LAYOUT.padding;
    const g = LAYOUT.gap;

    const left = -0.5 + p;
    const right = 0.5 - p;
    const top = 0.5 - p;
    const bottom = -0.5 + LAYOUT.barReserve + p;

    const cols = 3, rows = 3;
    const btnW = (right - left - (cols - 1) * g) / cols;
    const btnH = (top - bottom - (rows - 1) * g) / rows;

    const buttons = {};

    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            const x = left + c * (btnW + g) + btnW / 2;
            const y = top - r * (btnH + g) - btnH / 2;
            const isStart = r === 0 && c === 0;

            buttons[`btn_${r}_${c}`] = {
                x, y, width: btnW, height: btnH,
                color: isStart ? [0.2, 0.4, 0.8] : [0.85, 0.85, 0.85],
                hoverColor: isStart ? [0.35, 0.55, 0.95] : [1.0, 1.0, 1.0],
                action: isStart ? 'startSimulation' : null,
            };
        }
    }

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
let panelBuffer = null;
let panelIndexBuffer = null;
let buttonBuffer = null;
let buttonIndexBuffer = null;

let hoveredButton = null;
let barHovered = false;

let panelGrab = {
    active: false,
    hand: null,
    offset: [0, 0, 0],
};

let callbacks = {
    startSimulation: null,
    pauseSimulation: null,
    resetView: null,
};

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

// grab bar uses uvs for capsule/pill sdf
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

// ============================================================================
// INITIALIZATION
// ============================================================================

export function initVRPanel(glContext) {
    gl = glContext;

    createQuadGeometry();
    panelProgram = createProgram(PANEL_VS, PANEL_FS, 'Panel');
    buttonProgram = createProgram(BUTTON_VS, BUTTON_FS, 'Button');
    barProgram = createProgram(BAR_VS, BAR_FS, 'Bar');

    if (panelProgram && buttonProgram && barProgram) {
        console.log('✅ VR Panel initialized (3×3 grid + grab bar)');
        return true;
    }

    console.error('❌ Failed to initialize VR Panel');
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

    // reuse for buttons and bar
    buttonBuffer = panelBuffer;
    buttonIndexBuffer = panelIndexBuffer;
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
    if (cbs.startSimulation) callbacks.startSimulation = cbs.startSimulation;
    if (cbs.pauseSimulation) callbacks.pauseSimulation = cbs.pauseSimulation;
    if (cbs.resetView) callbacks.resetView = cbs.resetView;
}

// ============================================================================
// PANEL TRANSFORM
// ============================================================================

function getPanelModelMatrix() {
    const pos = PANEL.position;
    const rot = PANEL.rotation;
    const w = PANEL.width;
    const h = PANEL.height;
    const cos = Math.cos(rot);
    const sin = Math.sin(rot);

    return new Float32Array([
        w * cos, 0, w * -sin, 0,
        0, h, 0, 0,
        w * sin, 0, w * cos, 0,
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

// ============================================================================
// ray / poke intersection
// ============================================================================

export function rayIntersectsPanel(origin, direction) {
    const hit = rayToLocal(origin, direction);
    if (!hit) return null;

    if (Math.abs(hit.hitX) > 0.5 || Math.abs(hit.hitY) > 0.5) return null;

    const button = hitTestButton(hit.hitX, hit.hitY);
    return { button, distance: hit.distance };
}

export function fingerPokePanel(fingerTipPos) {
    const local = pointToLocal(fingerTipPos);
    if (!local) return null;

    if (Math.abs(local[2]) > 0.06) return null;
    if (Math.abs(local[0]) > 0.5 || Math.abs(local[1]) > 0.5) return null;

    return hitTestButton(local[0], local[1]);
}

// ============================================================================
// PANEL HOVER (buttons + bar)
// ============================================================================

export function updatePanelHover(leftController, rightController) {
    hoveredButton = null;
    barHovered = false;

    const controllers = [leftController, rightController].filter(Boolean);
    for (const ctrl of controllers) {
        const hit = rayToLocal(ctrl.origin, ctrl.direction);
        if (!hit || Math.abs(hit.hitX) > 0.55 || Math.abs(hit.hitY) > 0.6) continue;

        const btn = hitTestButton(hit.hitX, hit.hitY);
        if (btn) { hoveredButton = btn; return; }

        if (hitTestBar(hit.hitX, hit.hitY)) { barHovered = true; return; }
    }
}

// ============================================================================
// BUTTON TRIGGER
// ============================================================================

export function triggerPanelButton(buttonId) {
    const id = buttonId || hoveredButton;
    if (id && BUTTONS[id]) {
        const action = BUTTONS[id].action;
        if (action && callbacks[action]) {
            console.log(`🎮 Panel button pressed: ${id}`);
            callbacks[action]();
            return true;
        }
    }
    return false;
}

export function isHoveringPanel() {
    return hoveredButton !== null;
}

export function getHoveredButton() {
    return hoveredButton;
}

export function isBarHovered() {
    return barHovered;
}

// ============================================================================
// PANEL GRAB (controller squeeze or hand pinch on the bar)
// ============================================================================

// call each frame from the main loop. checks if a grab should start, continue, or end based on controller/hand state near the grab bar.
export function updatePanelGrab(leftCtrl, rightCtrl, leftSqueezing, rightSqueezing, leftPinching, rightPinching) {
    if (panelGrab.active) {
        const hand = panelGrab.hand;
        const ctrl = hand === 'left' ? leftCtrl : rightCtrl;
        const stillHolding = hand === 'left'
            ? (leftSqueezing || leftPinching)
            : (rightSqueezing || rightPinching);

        if (!stillHolding || !ctrl) {
            panelGrab.active = false;
            panelGrab.hand = null;
            return;
        }

        PANEL.position = [
            ctrl.origin.x + panelGrab.offset[0],
            ctrl.origin.y + panelGrab.offset[1],
            ctrl.origin.z + panelGrab.offset[2],
        ];
        return;
    }

    // try to start a grab — check both controller ray hitting bar and hand proximity
    const candidates = [
        { hand: 'left', ctrl: leftCtrl, squeezing: leftSqueezing, pinching: leftPinching },
        { hand: 'right', ctrl: rightCtrl, squeezing: rightSqueezing, pinching: rightPinching },
    ];

    for (const c of candidates) {
        if (!c.ctrl) continue;
        const grabbing = c.squeezing || c.pinching;
        if (!grabbing) continue;

        let nearBar = false;

        // controller ray → bar hit test
        if (c.squeezing) {
            const hit = rayToLocal(c.ctrl.origin, c.ctrl.direction);
            if (hit && hitTestBar(hit.hitX, hit.hitY)) nearBar = true;
        }

        // hand pinch → proximity to bar in world space
        if (c.pinching && !nearBar) {
            const local = pointToLocal(c.ctrl.origin);
            if (local && Math.abs(local[0]) <= BAR.width / 2 + 0.1 &&
                Math.abs(local[1] - BAR.y) <= 0.15 &&
                Math.abs(local[2]) <= 0.15) {
                nearBar = true;
            }
        }

        if (nearBar) {
            panelGrab.active = true;
            panelGrab.hand = c.hand;
            panelGrab.offset = [
                PANEL.position[0] - c.ctrl.origin.x,
                PANEL.position[1] - c.ctrl.origin.y,
                PANEL.position[2] - c.ctrl.origin.z,
            ];
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

    //buttons (3x3 grid)
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

function transformDirection(m, v) {
    const x = v[0], y = v[1], z = v[2];
    return [
        m[0] * x + m[4] * y + m[8] * z,
        m[1] * x + m[5] * y + m[9] * z,
        m[2] * x + m[6] * y + m[10] * z
    ];
}
