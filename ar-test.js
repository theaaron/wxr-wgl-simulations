// ============================================================================
// SHADERS
// ============================================================================

const VS = `#version 300 es
layout(location = 0) in vec3 a_position;
layout(location = 1) in vec3 a_normal;

uniform mat4 u_projection;
uniform mat4 u_view;
uniform mat4 u_model;

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

uniform vec3 u_lightDir;
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

function mat4Scale(s) {
    const m = mat4Identity();
    m[0] = s; m[5] = s; m[10] = s;
    return m;
}

// vector helpers
function v3add(a, b) { return [a[0]+b[0], a[1]+b[1], a[2]+b[2]]; }
function v3sub(a, b) { return [a[0]-b[0], a[1]-b[1], a[2]-b[2]]; }
function v3scale(a, s) { return [a[0]*s, a[1]*s, a[2]*s]; }
function v3len(a) { return Math.sqrt(a[0]*a[0]+a[1]*a[1]+a[2]*a[2]); }

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
// HAND TRACKING STATE
// ============================================================================

// cube transform driven by hand interaction
const cubeTransform = {
    position: [0, 0, -0.5],
    scale: 0.15,
};

// distance (meters) between thumb-tip and index-finger-tip to register pinch
const PINCH_THRESHOLD = 0.03;

// per-hand pinch state
const handPinch = {
    left:  { pinching: false, grabPoint: null },
    right: { pinching: false, grabPoint: null },
};

// snapshot taken at the moment each pinch starts (or state changes)
const grabSnapshot = {
    cubePos:       null,  // cubeTransform.position at last snapshot
    cubeScale:     null,  // cubeTransform.scale at last snapshot
    leftGrabPt:    null,  // left pinch midpoint at snapshot
    rightGrabPt:   null,  // right pinch midpoint at snapshot
    initialDist:   null,  // inter-hand distance at snapshot (two-hand)
    initialMidpt:  null,  // inter-hand midpoint at snapshot (two-hand)
};

// read a single hand joint world position
function getJointPos(frame, hand, jointName, refSpace) {
    const joint = hand.get(jointName);
    if (!joint) return null;
    const pose = frame.getJointPose(joint, refSpace);
    if (!pose) return null;
    const p = pose.transform.position;
    return [p.x, p.y, p.z];
}

function updateHandManipulation(leftData, rightData) {
    const leftNow  = leftData?.pinching  ?? false;
    const rightNow = rightData?.pinching ?? false;
    const leftWas  = handPinch.left.pinching;
    const rightWas = handPinch.right.pinching;

    if (leftData?.grabPoint)  handPinch.left.grabPoint  = leftData.grabPoint;
    if (rightData?.grabPoint) handPinch.right.grabPoint = rightData.grabPoint;

    const stateChanged = (leftNow !== leftWas) || (rightNow !== rightWas);
    handPinch.left.pinching  = leftNow;
    handPinch.right.pinching = rightNow;

    if (stateChanged && (leftNow || rightNow)) {
        grabSnapshot.cubePos   = [...cubeTransform.position];
        grabSnapshot.cubeScale = cubeTransform.scale;
        grabSnapshot.leftGrabPt  = leftNow  && handPinch.left.grabPoint  ? [...handPinch.left.grabPoint]  : null;
        grabSnapshot.rightGrabPt = rightNow && handPinch.right.grabPoint ? [...handPinch.right.grabPoint] : null;

        if (leftNow && rightNow && grabSnapshot.leftGrabPt && grabSnapshot.rightGrabPt) {
            grabSnapshot.initialDist  = v3len(v3sub(grabSnapshot.leftGrabPt, grabSnapshot.rightGrabPt));
            grabSnapshot.initialMidpt = v3scale(v3add(grabSnapshot.leftGrabPt, grabSnapshot.rightGrabPt), 0.5);
        }
    }

    if (!leftNow && !rightNow) return;

    if (leftNow && rightNow && handPinch.left.grabPoint && handPinch.right.grabPoint) {
        const currentDist = Math.max(0.001, v3len(v3sub(handPinch.left.grabPoint, handPinch.right.grabPoint)));
        const scaleFactor = currentDist / Math.max(0.001, grabSnapshot.initialDist || currentDist);
        cubeTransform.scale = Math.max(0.02, Math.min(2.0, (grabSnapshot.cubeScale || 0.15) * scaleFactor));

        const currentMid = v3scale(v3add(handPinch.left.grabPoint, handPinch.right.grabPoint), 0.5);
        const midDelta   = v3sub(currentMid, grabSnapshot.initialMidpt || currentMid);
        cubeTransform.position = v3add(grabSnapshot.cubePos || [0, 0, -0.5], midDelta);
    } else {
        const activeHand  = leftNow ? 'left' : 'right';
        const currentPt   = handPinch[activeHand].grabPoint;
        const snapshotPt  = leftNow ? grabSnapshot.leftGrabPt : grabSnapshot.rightGrabPt;
        if (currentPt && snapshotPt) {
            cubeTransform.position = v3add(grabSnapshot.cubePos || [0, 0, -0.5], v3sub(currentPt, snapshotPt));
        }
    }
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

async function startAR() {
    arBtn.disabled = true;
    setStatus('Starting AR…');

    try {
        xrSession = await navigator.xr.requestSession('immersive-ar', {
            requiredFeatures: ['local-floor'],
            optionalFeatures: ['dom-overlay', 'hand-tracking'],
            domOverlay: { root: document.getElementById('overlay') },
        });
    } catch (e) {
        try {
            xrSession = await navigator.xr.requestSession('immersive-ar', {
                requiredFeatures: ['local'],
                optionalFeatures: ['hand-tracking'],
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

    program    = createProgram(gl, VS, FS);
    posBuffer  = createBuffer(gl, CUBE_POSITIONS);
    normBuffer = createBuffer(gl, CUBE_NORMALS);

    vao = gl.createVertexArray();
    gl.bindVertexArray(vao);

    gl.bindBuffer(gl.ARRAY_BUFFER, posBuffer);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, normBuffer);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);

    gl.bindVertexArray(null);

    xrSession.addEventListener('end', onSessionEnd);
    arBtn.textContent = 'Exit AR';
    arBtn.disabled = false;
    arBtn.onclick = () => xrSession.end();

    setStatus('AR running — pinch to grab, both hands to scale');
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

    let leftHandData  = null;
    let rightHandData = null;

    for (const src of frame.session.inputSources) {
        if (!src.hand) continue;

        const thumbTip = getJointPos(frame, src.hand, 'thumb-tip', xrRefSpace);
        const indexTip = getJointPos(frame, src.hand, 'index-finger-tip', xrRefSpace);
        if (!thumbTip || !indexTip) continue;

        const pinchDist = v3len(v3sub(thumbTip, indexTip));
        const pinching  = pinchDist < PINCH_THRESHOLD;
        const grabPoint = v3scale(v3add(thumbTip, indexTip), 0.5);

        const data = { pinching, grabPoint };
        if (src.handedness === 'left')  leftHandData  = data;
        else if (src.handedness === 'right') rightHandData = data;
    }

    updateHandManipulation(leftHandData, rightHandData);

    const [px, py, pz] = cubeTransform.position;
    const model = mat4Multiply(
        mat4Translation(px, py, pz),
        mat4Scale(cubeTransform.scale)
    );

    const bothGrabbing = handPinch.left.pinching && handPinch.right.pinching;
    const anyGrabbing  = handPinch.left.pinching || handPinch.right.pinching;
    const color = bothGrabbing ? [0.4, 0.9, 1.0, 1.0]
                : anyGrabbing  ? [0.9, 0.5, 1.0, 1.0]
                :                [0.702, 0.639, 0.412, 1.0];

    const layer = xrSession.renderState.baseLayer;
    gl.bindFramebuffer(gl.FRAMEBUFFER, layer.framebuffer);

    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.clear(gl.DEPTH_BUFFER_BIT);

    gl.useProgram(program);
    gl.bindVertexArray(vao);

    gl.uniform3f(gl.getUniformLocation(program, 'u_lightDir'), 0.6, 1.0, 0.8);
    gl.uniform4fv(gl.getUniformLocation(program, 'u_color'), color);
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
