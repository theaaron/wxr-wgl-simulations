import { cubeSize, indices, vertices } from "./cube.js";
import { APPROX_COMPOSITE_FS, APPROX_COMPOSITE_VS, APPROX_FS, APPROX_VS, SIMPLE_FS, SIMPLE_VS } from "./shaders.js";
import { renderStructure } from "./rendering/renderStructure.js";
import { renderCubes } from "./rendering/renderCubes.js";
import { renderTestPlanes } from "./rendering/renderTestPlanes.js";
import { drawHelix } from "./rendering/drawHelix.js";
import { drawDNAHelix } from "./rendering/drawDNAHelix.js";
import { drawHelixCubes } from "./rendering/drawHelixCubes.js";


export const PATH = 'resources/atria_64x64x64.json';
    // const PATH = 'resources/13-350um-192x192x192_lra_grid.json';
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
    
    texture.width = width;
    texture.height = height;
    
    return texture;
}

// ============================================================================
// GLOBAL STATE
// ============================================================================

let gl = null;
let xrSession = null;
let xrReferenceSpace = null;

let simpleProgram = null;

let cubeBuffer = null;
let cubeColorBuffer = null; 
let indexBuffer = null;
let instanceBuffer = null;
let instanceCount = 0;
let quadBuffer = null;

// NEW: Plane geometry buffers
let planeVertexBuffer = null;
let planeIndexBuffer = null;
let planeColorBuffers = []; 

let drawBuffersExt = null;
let instancingExt = null;

let approxProgram = null;
let approxCompositeProgram = null;

let leftEyeApproxTextures = {
    accumTexture: null,
    revealTexture: null,
    framebuffer: null
};

let rightEyeApproxTextures = {
    accumTexture: null,
    revealTexture: null,
    framebuffer: null
};

const ALPHA = 0.5;  
let vrButton = null;
let statusDiv = null;

function updateStatus(message) {
    console.log(message);
    if (statusDiv) {
        statusDiv.textContent = message;
    }
}
// simple program


// end simple program

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

    simpleProgram = createProgram(gl, SIMPLE_VS, SIMPLE_FS);
    if (!simpleProgram) {
        updateStatus('Failed to create fallback shader program');
        return false;
    }

    if (drawBuffersExt) {
        approxProgram = createProgram(gl, APPROX_VS, APPROX_FS);
        approxCompositeProgram = createProgram(gl, APPROX_COMPOSITE_VS, APPROX_COMPOSITE_FS);
        
        if (approxProgram && approxCompositeProgram) {
            updateStatus('Approximate alpha blending available');
        } else {
            updateStatus('Failed to create approx programs - using fallback');
            drawBuffersExt = null;
        }
    }

    cubeBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, cubeBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

    indexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);

    const maxInstances = 1000;
    const instancePositions = new Float32Array(maxInstances * 3);
    const instanceColors = new Float32Array(maxInstances * 3); // NEW: Random colors
    let idx = 0;
    
    const colorPalette = [
        [1, 0, 0],    
        [0, 1, 0],    
        [0, 0, 1],   
    ];
    
    for (let x = 0; x < 10; x++) {
        for (let y = 0; y < 10; y++) {
            for (let z = 0; z < 10; z++) {
                const dx = x - 4.5, dy = y - 4.5, dz = z - 4.5;
                const distSq = dx*dx + dy*dy + dz*dz;
                if (distSq < 5*5) {
                    instancePositions[idx] = x * cubeSize;
                    instancePositions[idx + 1] = y * cubeSize;
                    instancePositions[idx + 2] = z * cubeSize - 3;
                    
                    const color = colorPalette[Math.floor(Math.random() * colorPalette.length)];
                    instanceColors[idx] = color[0];
                    instanceColors[idx + 1] = color[1];
                    instanceColors[idx + 2] = color[2];
                    
                    idx += 3;
                }
            }
        }
    }
    
    instanceCount = idx / 3;
    
    console.log(`Generated ${instanceCount} cubes with random colors`);
    console.log(`First 3 cube colors:`, 
        instanceColors.slice(0, 3),
        instanceColors.slice(3, 6),
        instanceColors.slice(6, 9)
    );
    
    instanceBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, instancePositions.subarray(0, idx), gl.STATIC_DRAW);
    
    cubeColorBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, cubeColorBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, instanceColors.subarray(0, idx), gl.STATIC_DRAW);

    const planeSize = 0.5; 
    const planeVertices = new Float32Array([
        -planeSize, -planeSize, 0.0,
         planeSize, -planeSize, 0.0,
         planeSize,  planeSize, 0.0,
        -planeSize,  planeSize, 0.0
    ]);
    
    const planeIndices = new Uint16Array([
        0, 1, 2,
        0, 2, 3
    ]);
    
    planeVertexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, planeVertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, planeVertices, gl.STATIC_DRAW);
    
    planeIndexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, planeIndexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, planeIndices, gl.STATIC_DRAW);
    
    const planeColors = [
        new Float32Array([1, 0, 0,  1, 0, 0,  1, 0, 0,  1, 0, 0]), 
        new Float32Array([0, 1, 0,  0, 1, 0,  0, 1, 0,  0, 1, 0]), 
        new Float32Array([0, 0, 1,  0, 0, 1,  0, 0, 1,  0, 0, 1])  
    ];
    
    for (let i = 0; i < planeColors.length; i++) {
        const colorBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, colorBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, planeColors[i], gl.STATIC_DRAW);
        planeColorBuffers.push(colorBuffer);
    }

    const quadVertices = new Float32Array([
        -1, -1,
         1, -1,
        -1,  1,
         1,  1
    ]);
    
    quadBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, quadVertices, gl.STATIC_DRAW);

    gl.clearColor(1.0, 1.0, 1.0, 1.0);
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);

    updateStatus('WebGL initialized with approximate alpha blending');
    return true;
}

// ============================================================================
// APPROXIMATE BLENDING SETUP
// ============================================================================

function createApproxFramebuffer(gl, accumTexture, revealTexture) {
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    
    gl.framebufferTexture2D(
        gl.FRAMEBUFFER,
        drawBuffersExt.COLOR_ATTACHMENT0_WEBGL,
        gl.TEXTURE_2D,
        accumTexture,
        0
    );
    
    gl.framebufferTexture2D(
        gl.FRAMEBUFFER,
        drawBuffersExt.COLOR_ATTACHMENT1_WEBGL,
        gl.TEXTURE_2D,
        revealTexture,
        0
    );
    
    const depthBuffer = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, depthBuffer);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, 
                          accumTexture.width, accumTexture.height);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, 
                              gl.RENDERBUFFER, depthBuffer);
    
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
        console.error('Framebuffer incomplete:', status);
        return null;
    }
    
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return fb;
}

function setupApproxTextures(textureSet, width, height) {
    if (textureSet.framebuffer) {
        gl.deleteTexture(textureSet.accumTexture);
        gl.deleteTexture(textureSet.revealTexture);
        gl.deleteFramebuffer(textureSet.framebuffer);
    }
    
    textureSet.accumTexture = createTexture(gl, width, height, gl.RGBA, gl.UNSIGNED_BYTE);
    textureSet.revealTexture = createTexture(gl, width, height, gl.RGBA, gl.UNSIGNED_BYTE);
    
    textureSet.framebuffer = createApproxFramebuffer(
        gl, 
        textureSet.accumTexture, 
        textureSet.revealTexture
    );
}

// ============================================================================
// RENDERING
// ============================================================================
// moved everything to separate files, see imports

// ============================================================================
// XR FUNCTIONS
// ============================================================================

function drawSceneWithApproxBlending(view) {
    const goOpaque = false;  
    const viewport = xrSession.renderState.baseLayer.getViewport(view);
    const width = Math.floor(viewport.width);
    const height = Math.floor(viewport.height);
    const x = Math.floor(viewport.x);
    const y = Math.floor(viewport.y);
    
    if (width <= 0 || height <= 0) return;
    
    const isLeftEye = view.eye === 'left';
    const textureSet = isLeftEye ? leftEyeApproxTextures : rightEyeApproxTextures;
    
    const modelMatrix = new Float32Array([
        1, 0, 0, 0,
        0, 1, 0, 0,
        0, 0, 1, 0,
        0, 0, 0, 1
    ]);
    
    gl.bindFramebuffer(gl.FRAMEBUFFER, xrSession.renderState.baseLayer.framebuffer);
    
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(x, y, width, height);
    gl.viewport(x, y, width, height);
    
    gl.clearColor(1.0, 1.0, 1.0, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    
    gl.disable(gl.BLEND); // Disable blending for opaque rendering
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LESS);
    gl.depthMask(true);

    const program = simpleProgram || approxProgram;
    renderStructure(gl, instancingExt, cubeBuffer, indexBuffer, ALPHA, PATH, view.projectionMatrix, view.transform.inverse.matrix, modelMatrix, program);
    
    gl.disable(gl.SCISSOR_TEST);
    if (goOpaque) {
        return; 
    }
    
    const needsRecreation = !textureSet.accumTexture || 
                           textureSet.accumTexture.width !== width ||
                           textureSet.accumTexture.height !== height;
    
    if (needsRecreation) {
        console.log(`Creating approx ${isLeftEye ? 'LEFT' : 'RIGHT'} eye textures: ${width}x${height}`);
        setupApproxTextures(textureSet, width, height);
    }
    
    // === RENDER TO OFFSCREEN FRAMEBUFFER ===
    gl.bindFramebuffer(gl.FRAMEBUFFER, textureSet.framebuffer);
    gl.viewport(0, 0, width, height);
    
    drawBuffersExt.drawBuffersWEBGL([
        drawBuffersExt.COLOR_ATTACHMENT0_WEBGL,
        drawBuffersExt.COLOR_ATTACHMENT1_WEBGL
    ]);
    
    gl.clearColor(0.0, 0.0, 0.0, 0.0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    
    gl.enable(gl.BLEND);
    gl.blendEquation(gl.FUNC_ADD);
    // ALPHA BLEND: Both color and alpha should be additive for weighted OIT
    gl.blendFunc(gl.ONE, gl.ONE);
    
    gl.depthMask(false); 
    gl.enable(gl.DEPTH_TEST); 
    gl.depthFunc(gl.LESS);
    
    gl.useProgram(approxProgram);
    const alphaLoc = gl.getUniformLocation(approxProgram, 'u_alpha');
    
    if (!drawSceneWithApproxBlending.loggedAlpha) {
        console.log('ALPHA constant:', ALPHA);
        console.log('Alpha uniform location:', alphaLoc);
        drawSceneWithApproxBlending.loggedAlpha = true;
    }
    
    gl.uniform1f(alphaLoc, ALPHA);

    renderStructure(gl, instancingExt, cubeBuffer, indexBuffer, ALPHA, PATH, view.projectionMatrix, view.transform.inverse.matrix, modelMatrix, approxProgram);
    // drawDNAHelix(gl, instancingExt, 2000, view.projectionMatrix, view.transform.inverse.matrix, approxProgram);
    // drawHelixCubes(gl, instancingExt, cubeBuffer, indexBuffer, ALPHA, 100, view.projectionMatrix, view.transform.inverse.matrix, approxProgram);
    // drawHelix(gl, instancingExt, 2000, view.projectionMatrix, view.transform.inverse.matrix, approxProgram);
    // renderTestPlanes(gl, instancingExt, planeVertexBuffer, planeIndexBuffer, planeColorBuffers, view.projectionMatrix, view.transform.inverse.matrix, approxProgram);
    // renderCubes(gl, instancingExt, cubeBuffer, indexBuffer, instanceBuffer, cubeColorBuffer, instanceCount, view.projectionMatrix, view.transform.inverse.matrix, modelMatrix, approxProgram);

    
    // === COMPOSITE PASS ===
    gl.bindFramebuffer(gl.FRAMEBUFFER, xrSession.renderState.baseLayer.framebuffer);
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(x, y, width, height);
    gl.viewport(x, y, width, height);
    
    gl.clearColor(1.0, 1.0, 1.0, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(true);
    
    gl.useProgram(approxCompositeProgram);
    
    const accumLoc = gl.getUniformLocation(approxCompositeProgram, 'u_accumTexture');
    const revealLoc = gl.getUniformLocation(approxCompositeProgram, 'u_revealTexture');
    
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, textureSet.accumTexture);
    gl.uniform1i(accumLoc, 0);
    
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, textureSet.revealTexture);
    gl.uniform1i(revealLoc, 1);
    
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
    const posLoc = gl.getAttribLocation(approxCompositeProgram, 'a_position');
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(posLoc);
    
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    
    gl.disable(gl.SCISSOR_TEST);
    gl.enable(gl.DEPTH_TEST);
}

function onXRFrame(time, frame) {
    if (!xrSession) return;
    
    xrSession.requestAnimationFrame(onXRFrame);

    const pose = frame.getViewerPose(xrReferenceSpace);
    if (!pose) return;

    const glLayer = xrSession.renderState.baseLayer;
    gl.bindFramebuffer(gl.FRAMEBUFFER, glLayer.framebuffer);
    
    // moved viewport clearing to drawSceneWithApproxBlending
    
    for (const view of pose.views) {
        drawSceneWithApproxBlending(view);
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
        updateStatus('Transparent cubes + test planes rendering with approximate alpha blending');
        
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
    
    // voxel scale slider for proper size of the cubes. probably no longer needed. 
    const scaleSlider = document.getElementById('voxel-scale');
    const scaleValue = document.getElementById('scale-value');
    if (scaleSlider && scaleValue) {
        renderStructure.voxelScale = parseFloat(scaleSlider.value);
        scaleSlider.addEventListener('input', (e) => {
            renderStructure.voxelScale = parseFloat(e.target.value);
            scaleValue.textContent = parseFloat(e.target.value).toFixed(1);
            console.log(`Voxel scale set to: ${renderStructure.voxelScale}x`);
        });
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