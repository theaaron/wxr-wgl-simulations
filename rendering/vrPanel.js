// VR Control Panel - floating UI for simulation controls
// Position: left side, waist height, angled toward user

// ============================================================================
// PANEL CONFIGURATION
// ============================================================================

const PANEL = {
    position: [-0.5, 0.0, -0.6],
    width: 0.35,
    height: 0.25,
    rotation: 25 * Math.PI / 180,
    backgroundColor: [0.1, 0.1, 0.15, 0.85],
    borderColor: [0.4, 0.4, 0.5, 1.0],
    borderWidth: 0.008
};

const BUTTONS = {
    startSimulation: {
        label: '▶ Start',
        x: 0,
        y: 0.06,
        width: 0.12,
        height: 0.05,
        color: [0.2, 0.6, 0.3],
        hoverColor: [0.3, 0.8, 0.4],
        action: 'startSimulation'
    },
    pauseSimulation: {
        label: '⏸ Pause',
        x: 0,
        y: 0,
        width: 0.12,
        height: 0.05,
        color: [0.6, 0.5, 0.2],
        hoverColor: [0.8, 0.7, 0.3],
        action: 'pauseSimulation'
    },
    resetView: {
        label: '↺ Reset',
        x: 0,
        y: -0.06,
        width: 0.12,
        height: 0.05,
        color: [0.4, 0.4, 0.5],
        hoverColor: [0.5, 0.5, 0.65],
        action: 'resetView'
    }
};

// ============================================================================
// STATE
// ============================================================================

let gl = null;
let panelProgram = null;
let buttonProgram = null;
let panelBuffer = null;
let panelIndexBuffer = null;
let buttonBuffer = null;
let buttonIndexBuffer = null;

let hoveredButton = null;
let callbacks = {
    startSimulation: null,
    pauseSimulation: null,
    resetView: null
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
        color = color * 1.3; // brighten on hover
    }
    fragColor = vec4(color, 1.0);
}
`;

// ============================================================================
// INITIALIZATION
// ============================================================================

export function initVRPanel(glContext) {
    gl = glContext;

    createPanelGeometry();
    createButtonGeometry();
    panelProgram = createProgram(PANEL_VS, PANEL_FS, 'Panel');
    buttonProgram = createProgram(BUTTON_VS, BUTTON_FS, 'Button');

    if (panelProgram && buttonProgram) {
        console.log('✅ VR Panel initialized');
        return true;
    }

    console.error('❌ Failed to initialize VR Panel');
    return false;
}

function createPanelGeometry() {
    // Simple quad for panel background
    const vertices = new Float32Array([
        -0.5, -0.5, 0,
        0.5, -0.5, 0,
        0.5, 0.5, 0,
        -0.5, 0.5, 0
    ]);

    const indices = new Uint16Array([0, 1, 2, 0, 2, 3]);

    panelBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, panelBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

    panelIndexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, panelIndexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
}

function createButtonGeometry() {
    // reusable quad for buttons (scaled/positioned via uniforms)
    const vertices = new Float32Array([
        -0.5, -0.5, 0,
        0.5, -0.5, 0,
        0.5, 0.5, 0,
        -0.5, 0.5, 0
    ]);

    const indices = new Uint16Array([0, 1, 2, 0, 2, 3]);

    buttonBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buttonBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

    buttonIndexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buttonIndexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
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
// CALLBACK REGISTRATION
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
// RAY INTERSECTION
// ============================================================================

export function rayIntersectsPanel(origin, direction) {
    const modelMatrix = getPanelModelMatrix();
    const invModel = invertMatrix(modelMatrix);

    const localOrigin = transformPoint(invModel, [origin.x, origin.y, origin.z]);
    const localDir = transformDirection(invModel, [direction.x, direction.y, direction.z]);

    if (Math.abs(localDir[2]) < 0.0001) return null;

    const t = -localOrigin[2] / localDir[2];
    if (t < 0) return null;

    const hitX = localOrigin[0] + t * localDir[0];
    const hitY = localOrigin[1] + t * localDir[1];

    if (Math.abs(hitX) > 0.5 || Math.abs(hitY) > 0.5) return null;

    for (const [id, btn] of Object.entries(BUTTONS)) {
        const btnLeft = btn.x - btn.width / 2;
        const btnRight = btn.x + btn.width / 2;
        const btnBottom = btn.y - btn.height / 2;
        const btnTop = btn.y + btn.height / 2;

        const scaledX = hitX * PANEL.width;
        const scaledY = hitY * PANEL.height;

        if (scaledX >= btnLeft && scaledX <= btnRight &&
            scaledY >= btnBottom && scaledY <= btnTop) {
            return { button: id, distance: t };
        }
    }

    return { button: null, distance: t };
}

export function updatePanelHover(leftController, rightController) {
    hoveredButton = null;

    if (leftController) {
        const hit = rayIntersectsPanel(leftController.origin, leftController.direction);
        if (hit && hit.button) {
            hoveredButton = hit.button;
            return;
        }
    }

    if (rightController) {
        const hit = rayIntersectsPanel(rightController.origin, rightController.direction);
        if (hit && hit.button) {
            hoveredButton = hit.button;
            return;
        }
    }
}

export function triggerPanelButton() {
    if (hoveredButton && BUTTONS[hoveredButton]) {
        const action = BUTTONS[hoveredButton].action;
        if (callbacks[action]) {
            console.log(`🎮 Panel button pressed: ${hoveredButton}`);
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

// ============================================================================
// RENDERING
// ============================================================================

export function renderVRPanel(projectionMatrix, viewMatrix) {
    if (!panelProgram || !buttonProgram) return;

    const modelMatrix = getPanelModelMatrix();

    // render panel background
    gl.useProgram(panelProgram);

    gl.uniformMatrix4fv(gl.getUniformLocation(panelProgram, 'u_projectionMatrix'), false, projectionMatrix);
    gl.uniformMatrix4fv(gl.getUniformLocation(panelProgram, 'u_viewMatrix'), false, viewMatrix);
    gl.uniformMatrix4fv(gl.getUniformLocation(panelProgram, 'u_modelMatrix'), false, modelMatrix);
    gl.uniform4fv(gl.getUniformLocation(panelProgram, 'u_color'), PANEL.backgroundColor);

    const posLoc = gl.getAttribLocation(panelProgram, 'a_position');
    gl.bindBuffer(gl.ARRAY_BUFFER, panelBuffer);
    gl.vertexAttribPointer(posLoc, 3, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(posLoc);

    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, panelIndexBuffer);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LESS);

    gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);

    // render buttons
    gl.useProgram(buttonProgram);

    gl.uniformMatrix4fv(gl.getUniformLocation(buttonProgram, 'u_projectionMatrix'), false, projectionMatrix);
    gl.uniformMatrix4fv(gl.getUniformLocation(buttonProgram, 'u_viewMatrix'), false, viewMatrix);
    gl.uniformMatrix4fv(gl.getUniformLocation(buttonProgram, 'u_modelMatrix'), false, modelMatrix);

    const btnPosLoc = gl.getAttribLocation(buttonProgram, 'a_position');
    gl.bindBuffer(gl.ARRAY_BUFFER, buttonBuffer);
    gl.vertexAttribPointer(btnPosLoc, 3, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(btnPosLoc);

    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buttonIndexBuffer);

    for (const [id, btn] of Object.entries(BUTTONS)) {
        const isHovered = hoveredButton === id;
        const color = isHovered ? btn.hoverColor : btn.color;

        gl.uniform3fv(gl.getUniformLocation(buttonProgram, 'u_buttonOffset'), [btn.x, btn.y, 0]);
        gl.uniform2fv(gl.getUniformLocation(buttonProgram, 'u_buttonSize'), [btn.width, btn.height]);
        gl.uniform3fv(gl.getUniformLocation(buttonProgram, 'u_buttonColor'), color);
        gl.uniform1f(gl.getUniformLocation(buttonProgram, 'u_hover'), isHovered ? 1.0 : 0.0);

        gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
    }

    gl.disable(gl.BLEND);
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

    const b00 = a00 * a11 - a01 * a10;
    const b01 = a00 * a12 - a02 * a10;
    const b02 = a00 * a13 - a03 * a10;
    const b03 = a01 * a12 - a02 * a11;
    const b04 = a01 * a13 - a03 * a11;
    const b05 = a02 * a13 - a03 * a12;
    const b06 = a20 * a31 - a21 * a30;
    const b07 = a20 * a32 - a22 * a30;
    const b08 = a20 * a33 - a23 * a30;
    const b09 = a21 * a32 - a22 * a31;
    const b10 = a21 * a33 - a23 * a31;
    const b11 = a22 * a33 - a23 * a32;

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
