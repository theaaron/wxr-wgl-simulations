import { cubeSize, indices, vertices } from "./cube.js";

// ============================================================================
// SHADERS FOR DEPTH PEELING
// ============================================================================

const PEEL_VS = `
    attribute vec3 a_position;
    attribute vec3 a_instancePosition;
    
    uniform mat4 u_projectionMatrix;
    uniform mat4 u_viewMatrix;
    uniform mat4 u_modelMatrix;
    
    varying vec3 v_position;
    varying vec3 v_normal;
    
    void main() {
        vec3 pos = a_position + a_instancePosition;
        vec4 worldPos = u_modelMatrix * vec4(pos, 1.0);
        gl_Position = u_projectionMatrix * u_viewMatrix * worldPos;
        
        v_position = worldPos.xyz;
        v_normal = a_position; // Cube normals are just the positions (centered at origin)
    }
`;

const PEEL_FS = `
    #extension GL_EXT_draw_buffers : require
    precision highp float;
    
    uniform sampler2D u_depthTexture;
    uniform vec2 u_screenSize;
    uniform float u_alpha;
    uniform int u_pass;
    
    varying vec3 v_position;
    varying vec3 v_normal;
    
    void main() {
        // Calculate screen coordinates
        vec2 screenCoord = gl_FragCoord.xy / u_screenSize;
        
        // Read previous depth
        float prevDepth = texture2D(u_depthTexture, screenCoord).r;
        
        // Current fragment depth
        float currDepth = gl_FragCoord.z;
        
        // Depth peeling: discard if at or in front of previous layer
        if (u_pass > 0 && currDepth <= prevDepth + 0.0001) {
            discard;
        }
        
        // Simple lighting
        vec3 lightDir = normalize(vec3(0.5, 0.5, -1.0));
        vec3 normal = normalize(v_normal);
        float diff = max(dot(normal, lightDir), 0.0) * 0.6 + 0.4;
        
        // Color based on position (rainbow cube effect)
        vec3 color = abs(normalize(v_position)) * diff;
        
        // Output depth and color
        gl_FragData[0] = vec4(currDepth, 0.0, 0.0, 1.0); // Depth
        gl_FragData[1] = vec4(color, u_alpha); // Color with alpha
    }
`;

// Fallback shader for devices without draw_buffers
const SIMPLE_FS = `
    precision highp float;
    
    varying vec3 v_position;
    varying vec3 v_normal;
    
    void main() {
        // Simple lighting
        vec3 lightDir = normalize(vec3(0.5, 0.5, -1.0));
        vec3 normal = normalize(v_normal);
        float diff = max(dot(normal, lightDir), 0.0) * 0.6 + 0.4;
        
        // Color based on position (rainbow cube effect)
        vec3 color = abs(normalize(v_position)) * diff;
        
        gl_FragColor = vec4(color, 0.3); // Semi-transparent
    }
`;

const BLEND_VS = `
    attribute vec2 a_position;
    varying vec2 v_texCoord;
    
    void main() {
        // Position is already in clip space (-1 to 1)
        v_texCoord = a_position * 0.5 + 0.5;
        gl_Position = vec4(a_position, 0.0, 1.0);
    }
`;

const BLEND_FS = `
    precision highp float;
    
    uniform sampler2D u_colorTexture;
    varying vec2 v_texCoord;
    
    void main() {
        vec4 color = texture2D(u_colorTexture, v_texCoord);
        // Premultiply alpha for correct blending
        gl_FragColor = vec4(color.rgb * color.a, color.a);
    }
`;

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

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
    if (!vertexShader || !fragmentShader) return null;
    
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

function createTexture(gl, width, height, format, type) {
    // Ensure integer dimensions
    width = Math.floor(width);
    height = Math.floor(height);
    
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, format, width, height, 0, format, type, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindTexture(gl.TEXTURE_2D, null);
    
    // Store dimensions on texture object for later checks
    texture.width = width;
    texture.height = height;
    
    return texture;
}

function createFramebuffer(gl, depthTexture, colorTexture) {
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    
    // Verify textures have dimensions
    if (!depthTexture.width || !colorTexture.width) {
        console.error('Textures missing dimensions:', depthTexture.width, colorTexture.width);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        return null;
    }
    
    // Attach depth texture to first color attachment
    gl.framebufferTexture2D(
        gl.FRAMEBUFFER, 
        drawBuffersExt.COLOR_ATTACHMENT0_WEBGL, 
        gl.TEXTURE_2D, 
        depthTexture, 
        0
    );
    
    // Attach color texture to second color attachment
    gl.framebufferTexture2D(
        gl.FRAMEBUFFER, 
        drawBuffersExt.COLOR_ATTACHMENT1_WEBGL, 
        gl.TEXTURE_2D, 
        colorTexture, 
        0
    );
    
    // Need a depth buffer for depth testing
    const depthBuffer = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, depthBuffer);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, depthTexture.width, depthTexture.height);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depthBuffer);
    
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
        console.error('Framebuffer incomplete:', status, 'Code:', status.toString(16));
        console.error('Depth texture dims:', depthTexture.width, 'x', depthTexture.height);
        console.error('Color texture dims:', colorTexture.width, 'x', colorTexture.height);
    }
    
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return fb;
}

// ============================================================================
// GLOBAL STATE
// ============================================================================

let gl = null;
let xrSession = null;
let xrReferenceSpace = null;

// Programs
let peelProgram = null;
let simpleProgram = null;
let blendProgram = null;

// Geometry
let cubeBuffer = null;
let indexBuffer = null;
let instanceBuffer = null;
let instanceCount = 0;
let quadBuffer = null;

// Extensions
let drawBuffersExt = null;
let instancingExt = null;

// Peeling textures - one set per eye
let leftEyeTextures = {
    depthTextures: [],
    colorTextures: [],
    framebuffers: []
};

let rightEyeTextures = {
    depthTextures: [],
    colorTextures: [],
    framebuffers: []
};

// Settings
const NUM_PASSES = 4; // Number of peeling passes
const ALPHA = 0.8; // Transparency level

// UI
let vrButton = null;
let statusDiv = null;

function updateStatus(message) {
    console.log(message);
    if (statusDiv) {
        statusDiv.textContent = message;
    }
}

// ============================================================================
// INITIALIZATION
// ============================================================================

function initGL() {
    const canvas = document.createElement('canvas');
    
    gl = canvas.getContext('webgl', { 
        xrCompatible: true,
        antialias: false,
        alpha: false
    });
    
    if (!gl) {
        updateStatus('Failed to get WebGL context');
        return false;
    }

    drawBuffersExt = gl.getExtension('WEBGL_draw_buffers');
    if (!drawBuffersExt) {
        updateStatus('WEBGL_draw_buffers not supported - using simple transparency');
    }

    instancingExt = gl.getExtension('ANGLE_instanced_arrays');
    if (!instancingExt) {
        updateStatus('Instanced rendering not supported');
        return false;
    }

    if (drawBuffersExt) {
        peelProgram = createProgram(gl, PEEL_VS, PEEL_FS);
        if (!peelProgram) {
            updateStatus('Failed to create peel program - trying fallback');
            drawBuffersExt = null; // Force fallback
        } else {
            updateStatus('Depth peeling program created successfully');
        }
    }
    
    simpleProgram = createProgram(gl, PEEL_VS, SIMPLE_FS);
    if (!simpleProgram) {
        updateStatus('Failed to create fallback shader program');
        return false;
    }
    
    blendProgram = createProgram(gl, BLEND_VS, BLEND_FS);
    
    if (!simpleProgram || !blendProgram) {
        updateStatus('Failed to create required shader programs');
        return false;
    }

    cubeBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, cubeBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

    indexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);

    const maxInstances = 1000;
    const instancePositions = new Float32Array(maxInstances * 3);
    let idx = 0;
    
    for (let x = 0; x < 10; x++) {
        for (let y = 0; y < 10; y++) {
            for (let z = 0; z < 10; z++) {
                const dx = x - 4.5, dy = y - 4.5, dz = z - 4.5;
                const distSq = dx*dx + dy*dy + dz*dz;
                if (distSq < 5*5) {
                    instancePositions[idx++] = x * cubeSize;
                    instancePositions[idx++] = y * cubeSize;
                    instancePositions[idx++] = z * cubeSize - 3;
                }
            }
        }
    }
    
    instanceCount = idx / 3;
    
    instanceBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, instancePositions.subarray(0, idx), gl.STATIC_DRAW);

    const quadVertices = new Float32Array([
        -1, -1,
         1, -1,
        -1,  1,
         1,  1
    ]);
    
    quadBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, quadVertices, gl.STATIC_DRAW);

    gl.clearColor(0.1, 0.1, 0.2, 1.0);
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);

    updateStatus('WebGL initialized with depth peeling');
    return true;
}

function setupPeelingTextures(textureSet, width, height) {
    width = Math.floor(width);
    height = Math.floor(height);
    
    if (width <= 0 || height <= 0) {
        console.error('Invalid texture dimensions:', width, 'x', height);
        return;
    }
    
    //OLD TEXTURE CLEANUP
    if (textureSet.depthTextures.length > 0) {
        textureSet.depthTextures.forEach(t => t && gl.deleteTexture(t));
        textureSet.colorTextures.forEach(t => t && gl.deleteTexture(t));
        textureSet.framebuffers.forEach(fb => fb && gl.deleteFramebuffer(fb));
    }
    
    textureSet.depthTextures = [
        createTexture(gl, width, height, gl.RGBA, gl.UNSIGNED_BYTE),
        createTexture(gl, width, height, gl.RGBA, gl.UNSIGNED_BYTE)
    ];
    
    textureSet.colorTextures = [
        createTexture(gl, width, height, gl.RGBA, gl.UNSIGNED_BYTE),
        createTexture(gl, width, height, gl.RGBA, gl.UNSIGNED_BYTE)
    ];
    
    if (!textureSet.depthTextures[0] || !textureSet.depthTextures[1] || 
        !textureSet.colorTextures[0] || !textureSet.colorTextures[1]) {
        console.error('Failed to create textures');
        return;
    }
    
    textureSet.framebuffers = [
        createFramebuffer(gl, textureSet.depthTextures[0], textureSet.colorTextures[0]),
        createFramebuffer(gl, textureSet.depthTextures[1], textureSet.colorTextures[1])
    ];
}

// ============================================================================
// RENDERING
// ============================================================================

function renderCubes(projMatrix, viewMatrix, modelMatrix, program) {
    gl.useProgram(program);
    
    const projLoc = gl.getUniformLocation(program, 'u_projectionMatrix');
    const viewLoc = gl.getUniformLocation(program, 'u_viewMatrix');
    const modelLoc = gl.getUniformLocation(program, 'u_modelMatrix');
    
    gl.uniformMatrix4fv(projLoc, false, projMatrix);
    gl.uniformMatrix4fv(viewLoc, false, viewMatrix);
    gl.uniformMatrix4fv(modelLoc, false, modelMatrix);
    
    const posLoc = gl.getAttribLocation(program, 'a_position');
    const instPosLoc = gl.getAttribLocation(program, 'a_instancePosition');
    
    gl.bindBuffer(gl.ARRAY_BUFFER, cubeBuffer);
    gl.vertexAttribPointer(posLoc, 3, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(posLoc);
    instancingExt.vertexAttribDivisorANGLE(posLoc, 0);
    
    gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuffer);
    gl.vertexAttribPointer(instPosLoc, 3, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(instPosLoc);
    instancingExt.vertexAttribDivisorANGLE(instPosLoc, 1);
    
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    
    instancingExt.drawElementsInstancedANGLE(
        gl.TRIANGLES, 
        36, 
        gl.UNSIGNED_SHORT, 
        0, 
        instanceCount
    );
}

function blendLayer(colorTexture) {
    gl.useProgram(blendProgram);
    
    const posLoc = gl.getAttribLocation(blendProgram, 'a_position');
    const texLoc = gl.getUniformLocation(blendProgram, 'u_colorTexture');
    
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, colorTexture);
    gl.uniform1i(texLoc, 0);
    
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(posLoc);
    
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}

function drawSceneWithPeeling(view) {
    const viewport = xrSession.renderState.baseLayer.getViewport(view);

    const width = Math.floor(viewport.width);
    const height = Math.floor(viewport.height);
    const x = Math.floor(viewport.x);
    const y = Math.floor(viewport.y);
    

    if (width <= 0 || height <= 0) {
        return;
    }
    
    const isLeftEye = viewport.x === 0;
    const textureSet = isLeftEye ? leftEyeTextures : rightEyeTextures;
    
    // Debug - only log once every 60 frames -- NOT NEEDED FOR NOW
    // if (Math.random() < 0.016) {
    //     console.log(`Eye ${isLeftEye ? 'L' : 'R'}: viewport(${x}, ${y}, ${width}, ${height})`);
    // }
    
    const needsRecreation = textureSet.depthTextures.length === 0 || 
                           !textureSet.depthTextures[0] ||
                           textureSet.depthTextures[0].width !== width || 
                           textureSet.depthTextures[0].height !== height;
    
    if (needsRecreation) {
        console.log(`Creating ${isLeftEye ? 'LEFT' : 'RIGHT'} eye textures: ${width}x${height}`);
        setupPeelingTextures(textureSet, width, height);
        
        if (!textureSet.framebuffers[0] || !textureSet.framebuffers[1]) {
            console.error(`Failed to create ${isLeftEye ? 'LEFT' : 'RIGHT'} eye framebuffers!`);
        }
    }
    
    gl.viewport(x, y, width, height);
    
    const modelMatrix = new Float32Array([
        1, 0, 0, 0,
        0, 1, 0, 0,
        0, 0, 1, 0,
        0, 0, 0, 1
    ]);
    
    if (!drawBuffersExt || !peelProgram) {
        console.log(`Using simple fallback for ${isLeftEye ? 'LEFT' : 'RIGHT'} eye`);
        if (!simpleProgram) {
            return;
        }
        gl.bindFramebuffer(gl.FRAMEBUFFER, xrSession.renderState.baseLayer.framebuffer);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        renderCubes(view.projectionMatrix, view.transform.inverse.matrix, modelMatrix, simpleProgram);
        return;
    }
    
    if (!textureSet.framebuffers[0] || !textureSet.framebuffers[1]) {
        console.log(`${isLeftEye ? 'LEFT' : 'RIGHT'} eye framebuffers invalid, using fallback`);
        if (!simpleProgram) {
            return;
        }
        gl.bindFramebuffer(gl.FRAMEBUFFER, xrSession.renderState.baseLayer.framebuffer);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        renderCubes(view.projectionMatrix, view.transform.inverse.matrix, modelMatrix, simpleProgram);
        return;
    }
    

    let writeFB = 0;
    let readFB = 1;
    
    if (Math.random() < 0.01) {
        console.log(`${isLeftEye ? 'L' : 'R'} eye: Starting peeling passes`);
    }
    
    for (let pass = 0; pass < NUM_PASSES; pass++) {

        gl.bindFramebuffer(gl.FRAMEBUFFER, textureSet.framebuffers[writeFB]);
        
        gl.viewport(0, 0, width, height);
        gl.disable(gl.SCISSOR_TEST); 
        
        const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
        if (status !== gl.FRAMEBUFFER_COMPLETE) {
            console.error(`${isLeftEye ? 'L' : 'R'} eye pass ${pass}: Framebuffer incomplete! Status: ${status.toString(16)}`);
            break;
        }
        
        drawBuffersExt.drawBuffersWEBGL([
            drawBuffersExt.COLOR_ATTACHMENT0_WEBGL,
            drawBuffersExt.COLOR_ATTACHMENT1_WEBGL
        ]);
        
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        
        gl.useProgram(peelProgram);
        const passLoc = gl.getUniformLocation(peelProgram, 'u_pass');
        const depthTexLoc = gl.getUniformLocation(peelProgram, 'u_depthTexture');
        const screenSizeLoc = gl.getUniformLocation(peelProgram, 'u_screenSize');
        const alphaLoc = gl.getUniformLocation(peelProgram, 'u_alpha');
        
        gl.uniform1i(passLoc, pass);
        gl.uniform2f(screenSizeLoc, width, height);
        gl.uniform1f(alphaLoc, ALPHA);
        
        if (pass > 0) {
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, textureSet.depthTextures[readFB]);
            gl.uniform1i(depthTexLoc, 0);
        }
        
        renderCubes(view.projectionMatrix, view.transform.inverse.matrix, modelMatrix, peelProgram);
        
        const temp = writeFB;
        writeFB = readFB;
        readFB = temp;
    }
    
    if (Math.random() < 0.01) {
        console.log(`${isLeftEye ? 'L' : 'R'} eye: Completed peeling passes, final writeFB=${writeFB}, readFB=${readFB}`);
    }
    
    gl.bindFramebuffer(gl.FRAMEBUFFER, xrSession.renderState.baseLayer.framebuffer);
    
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(x, y, width, height);
    gl.viewport(x, y, width, height);
    
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    
    blendLayer(textureSet.colorTextures[0]);
    blendLayer(textureSet.colorTextures[1]);
    
    gl.disable(gl.SCISSOR_TEST);
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
}

// ============================================================================
// XR FUNCTIONS
// ============================================================================

function onXRFrame(time, frame) {
    if (!xrSession) return;
    
    xrSession.requestAnimationFrame(onXRFrame);

    const pose = frame.getViewerPose(xrReferenceSpace);
    if (!pose) return;

    const glLayer = xrSession.renderState.baseLayer;
    gl.bindFramebuffer(gl.FRAMEBUFFER, glLayer.framebuffer);
    
    gl.clearColor(0.2, 0.2, 0.2, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    
    for (const view of pose.views) {
        drawSceneWithPeeling(view);
    }
}

async function enterVR() {
    if (xrSession) {
        xrSession.end();
        return;
    }

    try {
        updateStatus('Requesting VR session...');
        
        const session = await navigator.xr.requestSession('immersive-vr');
        xrSession = session;
        
        updateStatus('VR session started');
        vrButton.textContent = 'Exit VR';

        session.addEventListener('end', () => {
            updateStatus('VR session ended');
            xrSession = null;
            xrReferenceSpace = null;
            vrButton.textContent = 'Enter VR';
        });

        await gl.makeXRCompatible();
        
        const xrLayer = new XRWebGLLayer(session, gl);
        await session.updateRenderState({ baseLayer: xrLayer });

        xrReferenceSpace = await session.requestReferenceSpace('local');
        updateStatus('Transparent cubes rendering with depth peeling');
        
        session.requestAnimationFrame(onXRFrame);

    } catch (error) {
        updateStatus(`VR Error: ${error.message}`);
        console.error('VR session error:', error);
        if (xrSession) {
            xrSession.end();
            xrSession = null;
        }
    }
}

// ============================================================================
// STARTUP
// ============================================================================

window.addEventListener('load', async () => {
    vrButton = document.getElementById('vr-button');
    statusDiv = document.getElementById('status');

    if (!vrButton || !statusDiv) {
        updateStatus('Missing HTML elements');
        return;
    }

    if (!initGL()) {
        updateStatus('WebGL initialization failed');
        return;
    }

    if (!navigator.xr) {
        updateStatus('WebXR not supported');
        return;
    }

    try {
        const supported = await navigator.xr.isSessionSupported('immersive-vr');
        if (supported) {
            updateStatus('VR supported - click Enter VR');
            vrButton.disabled = false;
            vrButton.addEventListener('click', enterVR);
        } else {
            updateStatus('VR not supported on this device');
        }
    } catch (error) {
        updateStatus(`Error checking VR support: ${error.message}`);
    }
});