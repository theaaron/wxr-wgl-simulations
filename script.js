const VS_SOURCE = `
    attribute vec4 a_position;
    uniform mat4 u_projectionMatrix;
    uniform mat4 u_viewMatrix;
    void main() {
        // Apply the view matrix (camera transform) first, then the projection.
        vec4 viewPosition = u_viewMatrix * a_position;
        gl_Position = u_projectionMatrix * viewPosition;
    }
`;

const FS_SOURCE = `
    precision mediump float;
    void main() {
        gl_FragColor = vec4(1.0, 0.0, 0.0, 1.0); // Red triangle
    }
`;

function compileShader(gl, source, type) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error('Shader compile error:', gl.getShaderInfoLog(shader));
        gl.deleteShader(shader);
        return null;
    }
    return shader;
}

function createProgram(gl, vsSource, fsSource) {
    const vertexShader = compileShader(gl, vsSource, gl.VERTEX_SHADER);
    const fragmentShader = compileShader(gl, fsSource, gl.FRAGMENT_SHADER);
    const program = gl.createProgram();
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        console.error('Program link error:', gl.getProgramInfoLog(program));
        gl.deleteProgram(program);
        return null;
    }
    return program;
}

let gl = null;
let xrSession = null;
let xrReferenceSpace = null;
let program = null;
let triangleBuffer = null;
let positionAttrib = null;
let xrCanvas = null;
let vrButton = null;

function initGL() {
    xrCanvas.width = window.innerWidth;
    xrCanvas.height = window.innerHeight;
    
    gl = xrCanvas.getContext('webgl', { xrCompatible: true });
    if (!gl) return false;

    program = createProgram(gl, VS_SOURCE, FS_SOURCE);
    gl.useProgram(program);

    positionAttrib = gl.getAttribLocation(program, 'a_position');
    
    program.projectionMatrixUniform = gl.getUniformLocation(program, 'u_projectionMatrix');
    program.viewMatrixUniform = gl.getUniformLocation(program, 'u_viewMatrix');

    const vertices = new Float32Array([
        0.0, 0.5, -2.0,  
       -0.5, -0.5, -2.0,
        0.5, -0.5, -2.0 
    ]);
    triangleBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, triangleBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
    
    gl.clearColor(0.1, 0.1, 0.2, 1.0);
    gl.enable(gl.DEPTH_TEST);

    return true;
}

// --- WebXR Frame Rendering ---------------------------------------------------

function drawGLScene(view) {
    const viewport = xrSession.renderState.baseLayer.getViewport(view);
    gl.viewport(viewport.x, viewport.y, viewport.width, viewport.height);
    
    gl.uniformMatrix4fv(program.projectionMatrixUniform, false, view.projectionMatrix);
    gl.uniformMatrix4fv(program.viewMatrixUniform, false, view.transform.inverse.matrix);

    gl.bindBuffer(gl.ARRAY_BUFFER, triangleBuffer);
    gl.vertexAttribPointer(positionAttrib, 3, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(positionAttrib);

    gl.drawArrays(gl.TRIANGLES, 0, 3);
}

function onXRFrame(time, frame) {
    xrSession.requestAnimationFrame(onXRFrame);

    const pose = frame.getViewerPose(xrReferenceSpace);

    if (pose) {
        const glLayer = xrSession.renderState.baseLayer;
        gl.bindFramebuffer(gl.FRAMEBUFFER, glLayer.framebuffer);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        
        for (const view of pose.views) {
            drawGLScene(view);
        }
    }
}

// --- WebXR Session Management ------------------------------------------------

function onSessionStarted(session, isImmersive) {
    if (xrSession && xrSession.end) {
        xrSession.end();
    }
    xrSession = session;
    
    session.addEventListener('end', onSessionEnded);
    vrButton.textContent = isImmersive ? 'Exit VR' : 'Enter VR';
    
    gl.makeXRCompatible().then(() => {
        const xrLayer = new XRWebGLLayer(session, gl);
        session.updateRenderState({
            baseLayer: xrLayer
        });

        const spaceType = isImmersive ? 'local-floor' : 'viewer';
        
        session.requestReferenceSpace(spaceType).then(referenceSpace => {
            xrReferenceSpace = referenceSpace;
            session.requestAnimationFrame(onXRFrame);
        });
    }).catch(e => {
        console.error("Failed to make WebGL context XR compatible or create layer:", e);
        session.end();
    });
}

function onSessionEnded() {
    xrSession = null;
    xrReferenceSpace = null;
    requestInlineSession();
}

async function requestInlineSession() {
    try {
        const session = await navigator.xr.requestSession('inline');
        onSessionStarted(session, false);
    } catch (error) {
        console.error("Failed to request initial inline session:", error);
    }
}

async function onVRButtonClick() {
    if (xrSession && xrSession.mode === 'immersive-vr') {
        xrSession.end();
        return;
    }
    
    try {
        const session = await navigator.xr.requestSession('immersive-vr', {
            requiredFeatures: ['local-floor'] 
        });
        onSessionStarted(session, true);
    } catch (error) {
        console.error("Failed to start immersive-vr session with 'local-floor'. Trying 'local':", error);
        try {
            const session = await navigator.xr.requestSession('immersive-vr', {
                requiredFeatures: ['local']
            });
            onSessionStarted(session, true);
        } catch (fallbackError) {
            console.error("Failed to start immersive-vr session even with 'local' features:", fallbackError);
        }
    }
}

window.onload = async () => {
    xrCanvas = document.getElementById('xr-canvas');
    vrButton = document.getElementById('vr-button');

    if (!xrCanvas || !vrButton) return;
    if (!initGL()) return;

    if (navigator.xr) {
        const supported = await navigator.xr.isSessionSupported('immersive-vr');
        if (supported) {
            vrButton.style.display = 'block';
            vrButton.addEventListener('click', onVRButtonClick);
        }
        requestInlineSession();

    } else {
        console.warn("WebXR API not found. Showing a static WebGL triangle.");
    }
    
    window.addEventListener('resize', () => {
        if (!xrSession) {
            initGL();
        }
    });
};