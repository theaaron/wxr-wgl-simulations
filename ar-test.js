// ============================================================================
// SHADERS
// ============================================================================

const VS = `#version 300 es
uniform mat4 u_projection;
uniform mat4 u_view;
uniform mat4 u_model;

in vec3 a_position;
in vec3 a_normal;

out vec3 v_normal;
out vec3 v_fragPos;

void main() {
    vec4 worldPos = u_model * vec4(a_position, 1.0);
    v_fragPos     = worldPos.xyz;
    v_normal      = mat3(u_model) * a_normal;
    gl_Position   = u_projection * u_view * worldPos;
}`;

const FS = `#version 300 es
precision mediump float;

in vec3 v_normal;
in vec3 v_fragPos;

out vec4 fragColor;

uniform vec3 u_lightDir;   // normalized, world space
uniform vec4 u_color;

void main() {
    vec3 n       = normalize(v_normal);
    float diff   = max(dot(n, normalize(u_lightDir)), 0.0);
    float ambient = 0.3;
    float light   = ambient + (1.0 - ambient) * diff;
    fragColor     = vec4(u_color.rgb * light, u_color.a);
}`;

// ============================================================================
// CUBE GEOMETRY  (positions + normals, 36 vertices)
// ============================================================================

// prettier-ignore
const CUBE_POSITIONS = new Float32Array([
    -0.5,-0.5, 0.5,  0.5,-0.5, 0.5,  0.5, 0.5, 0.5,
    -0.5,-0.5, 0.5,  0.5, 0.5, 0.5, -0.5, 0.5, 0.5,
     0.5,-0.5,-0.5, -0.5,-0.5,-0.5, -0.5, 0.5,-0.5,
     0.5,-0.5,-0.5, -0.5, 0.5,-0.5,  0.5, 0.5,-0.5,
     0.5,-0.5, 0.5,  0.5,-0.5,-0.5,  0.5, 0.5,-0.5,
     0.5,-0.5, 0.5,  0.5, 0.5,-0.5,  0.5, 0.5, 0.5,
    -0.5,-0.5,-0.5, -0.5,-0.5, 0.5, -0.5, 0.5, 0.5,
    -0.5,-0.5,-0.5, -0.5, 0.5, 0.5, -0.5, 0.5,-0.5,
    -0.5, 0.5, 0.5,  0.5, 0.5, 0.5,  0.5, 0.5,-0.5,
    -0.5, 0.5, 0.5,  0.5, 0.5,-0.5, -0.5, 0.5,-0.5,
    -0.5,-0.5,-0.5,  0.5,-0.5,-0.5,  0.5,-0.5, 0.5,
    -0.5,-0.5,-0.5,  0.5,-0.5, 0.5, -0.5,-0.5, 0.5,
]);

// prettier-ignore
const CUBE_NORMALS = new Float32Array([
     0, 0, 1,   0, 0, 1,   0, 0, 1,   0, 0, 1,   0, 0, 1,   0, 0, 1,
     0, 0,-1,   0, 0,-1,   0, 0,-1,   0, 0,-1,   0, 0,-1,   0, 0,-1,
     1, 0, 0,   1, 0, 0,   1, 0, 0,   1, 0, 0,   1, 0, 0,   1, 0, 0,
    -1, 0, 0,  -1, 0, 0,  -1, 0, 0,  -1, 0, 0,  -1, 0, 0,  -1, 0, 0,
     0, 1, 0,   0, 1, 0,   0, 1, 0,   0, 1, 0,   0, 1, 0,   0, 1, 0,
     0,-1, 0,   0,-1, 0,   0,-1, 0,   0,-1, 0,   0,-1, 0,   0,-1, 0,
]);

// ============================================================================
// MATH HELPERS
// ============================================================================

function mat4Identity() {
    return new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]);
}

function mat4RotateY(rad) {
    const c = Math.cos(rad), s = Math.sin(rad);
    return new Float32Array([
         c, 0, s, 0,
         0, 1, 0, 0,
        -s, 0, c, 0,
         0, 0, 0, 1,
    ]);
}

function mat4RotateX(rad) {
    const c = Math.cos(rad), s = Math.sin(rad);
    return new Float32Array([
        1,  0,  0, 0,
        0,  c, -s, 0,
        0,  s,  c, 0,
        0,  0,  0, 1,
    ]);
}

function mat4Multiply(a, b) {
    const out = new Float32Array(16);
    for (let col = 0; col < 4; col++) {
        for (let row = 0; row < 4; row++) {
            out[col * 4 + row] =
                a[row +  0] * b[col * 4 + 0] +
                a[row +  4] * b[col * 4 + 1] +
                a[row +  8] * b[col * 4 + 2] +
                a[row + 12] * b[col * 4 + 3];
        }
    }
    return out;
}

function mat4Translation(x, y, z) {
    const m = mat4Identity();
    m[12] = x; m[13] = y; m[14] = z;
    return m;
}

// ============================================================================
// GL HELPERS
// ============================================================================

function compileShader(gl, src, type) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
        throw new Error(gl.getShaderInfoLog(s));
    return s;
}

function createProgram(gl, vs, fs) {
    const p = gl.createProgram();
    gl.attachShader(p, compileShader(gl, vs, gl.VERTEX_SHADER));
    gl.attachShader(p, compileShader(gl, fs, gl.FRAGMENT_SHADER));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS))
        throw new Error(gl.getProgramInfoLog(p));
    return p;
}

function createBuffer(gl, data) {
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    return buf;
}

// ============================================================================
// MAIN
// ============================================================================

const statusEl = document.getElementById('status');
const arBtn    = document.getElementById('ar-button');

function setStatus(msg) {
    statusEl.textContent = msg;
    console.log('[ar-test]', msg);
}

if (navigator.xr) {
    navigator.xr.isSessionSupported('immersive-ar').then(supported => {
        if (supported) {
            arBtn.disabled = false;
            setStatus('AR ready — tap Enter AR');
        } else {
            setStatus('immersive-ar not supported on this device');
        }
    });
} else {
    setStatus('WebXR not available in this browser');
}

arBtn.addEventListener('click', startAR);

// ============================================================================
// AR SESSION
// ============================================================================

let gl = null;
let program = null;
let posBuffer = null, normBuffer = null;
let vao = null;
let xrSession = null;
let xrRefSpace = null;
let angle = 0;

async function startAR() {
    arBtn.disabled = true;
    setStatus('Starting AR…');

    try {
        xrSession = await navigator.xr.requestSession('immersive-ar', {
            requiredFeatures: ['local-floor'],
            optionalFeatures: ['dom-overlay'],
            domOverlay: { root: document.getElementById('overlay') },
        });
    } catch (e) {
        try {
            xrSession = await navigator.xr.requestSession('immersive-ar', {
                requiredFeatures: ['local'],
            });
        } catch (e2) {
            setStatus('Failed to start AR: ' + e2.message);
            arBtn.disabled = false;
            return;
        }
    }

    const canvas = document.createElement('canvas');
    gl = canvas.getContext('webgl2', { xrCompatible: true });
    if (!gl) { setStatus('WebGL2 not available'); return; }

    await gl.makeXRCompatible();
    xrSession.updateRenderState({
        baseLayer: new XRWebGLLayer(xrSession, gl),
    });

    xrRefSpace = await xrSession.requestReferenceSpace('local-floor').catch(
        () => xrSession.requestReferenceSpace('local')
    );

    program   = createProgram(gl, VS, FS);
    posBuffer = createBuffer(gl, CUBE_POSITIONS);
    normBuffer = createBuffer(gl, CUBE_NORMALS);

    vao = gl.createVertexArray();
    gl.bindVertexArray(vao);

    const aPos = gl.getAttribLocation(program, 'a_position');
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuffer);
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 0, 0);

    const aNorm = gl.getAttribLocation(program, 'a_normal');
    gl.bindBuffer(gl.ARRAY_BUFFER, normBuffer);
    gl.enableVertexAttribArray(aNorm);
    gl.vertexAttribPointer(aNorm, 3, gl.FLOAT, false, 0, 0);

    gl.bindVertexArray(null);

    xrSession.addEventListener('end', onSessionEnd);
    arBtn.textContent = 'Exit AR';
    arBtn.disabled = false;
    arBtn.onclick = () => xrSession.end();

    setStatus('AR running');
    xrSession.requestAnimationFrame(onXRFrame);
}

function onSessionEnd() {
    xrSession = null;
    arBtn.textContent = 'Enter AR';
    arBtn.disabled = false;
    arBtn.onclick = startAR;
    setStatus('AR ended');
}

// ============================================================================
// RENDER LOOP
// ============================================================================

function onXRFrame(time, frame) {
    xrSession.requestAnimationFrame(onXRFrame);

    const pose = frame.getViewerPose(xrRefSpace);
    if (!pose) return;

    const layer  = xrSession.renderState.baseLayer;
    gl.bindFramebuffer(gl.FRAMEBUFFER, layer.framebuffer);

    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.clear(gl.DEPTH_BUFFER_BIT);

    angle += 0.01;

    const translation = mat4Translation(0, 0, -1.5);
    const rotY  = mat4RotateY(angle);
    const rotX  = mat4RotateX(angle * 0.4);
    const model = mat4Multiply(translation, mat4Multiply(rotY, rotX));

    gl.useProgram(program);
    gl.bindVertexArray(vao);

    gl.uniform3f(gl.getUniformLocation(program, 'u_lightDir'), 0.6, 1.0, 0.8);
    gl.uniform4f(gl.getUniformLocation(program, 'u_color'), 0.702, 0.639, 0.412, 1.0);
    gl.uniformMatrix4fv(gl.getUniformLocation(program, 'u_model'), false, model);

    for (const view of pose.views) {
        const vp = layer.getViewport(view);
        gl.viewport(vp.x, vp.y, vp.width, vp.height);

        gl.uniformMatrix4fv(
            gl.getUniformLocation(program, 'u_projection'),
            false,
            view.projectionMatrix
        );
        gl.uniformMatrix4fv(
            gl.getUniformLocation(program, 'u_view'),
            false,
            view.transform.inverse.matrix
        );

        gl.drawArrays(gl.TRIANGLES, 0, 36);
    }

    gl.bindVertexArray(null);
}
