// // import { cubeSize, indices, vertices } from "./cube.js";
// // import { APPROX_COMPOSITE_FS, APPROX_COMPOSITE_VS, APPROX_FS, APPROX_VS } from "./shaders.js";

// // const SIMPLE_FS = `
// //     precision highp float;
    
// //     uniform int u_useVertexColor;
    
// //     varying vec3 v_position;
// //     varying vec3 v_normal;
// //     varying vec3 v_color;
    
// //     void main() {
// //         // Simple lighting
// //         vec3 lightDir = normalize(vec3(0.5, 0.5, -1.0));
// //         vec3 normal = normalize(v_normal);
// //         float diff = max(dot(normal, lightDir), 0.0) * 0.6 + 0.4;
        
// //         // Color: use vertex color if available, otherwise position-based
// //         vec3 color;
// //         if (u_useVertexColor == 1) {
// //             color = v_color * diff;
// //         } else {
// //             color = abs(normalize(v_position)) * diff;
// //         }
        
// //         gl_FragColor = vec4(color, 0.3); // Semi-transparent
// //     }
// // `;

// // // ============================================================================
// // // UTILITY FUNCTIONS
// // // ============================================================================

// // function compileShader(gl, source, type) {
// //     const shader = gl.createShader(type);
// //     gl.shaderSource(shader, source);
// //     gl.compileShader(shader);
// //     if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
// //         console.error('Shader compile error:', gl.getShaderInfoLog(shader));
// //         gl.deleteShader(shader);
// //         return null;
// //     }
// //     return shader;
// // }

// // function createProgram(gl, vsSource, fsSource) {
// //     const vertexShader = compileShader(gl, vsSource, gl.VERTEX_SHADER);
// //     const fragmentShader = compileShader(gl, fsSource, gl.FRAGMENT_SHADER);
// //     if (!vertexShader || !fragmentShader) return null;
    
// //     const program = gl.createProgram();
// //     gl.attachShader(program, vertexShader);
// //     gl.attachShader(program, fragmentShader);
// //     gl.linkProgram(program);
    
// //     if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
// //         console.error('Program link error:', gl.getProgramInfoLog(program));
// //         gl.deleteProgram(program);
// //         return null;
// //     }
// //     return program;
// // }

// // function createTexture(gl, width, height, format, type) {
// //     width = Math.floor(width);
// //     height = Math.floor(height);
    
// //     const texture = gl.createTexture();
// //     gl.bindTexture(gl.TEXTURE_2D, texture);
// //     gl.texImage2D(gl.TEXTURE_2D, 0, format, width, height, 0, format, type, null);
// //     gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
// //     gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
// //     gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
// //     gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
// //     gl.bindTexture(gl.TEXTURE_2D, null);
    
// //     texture.width = width;
// //     texture.height = height;
    
// //     return texture;
// // }

// // // ============================================================================
// // // GLOBAL STATE
// // // ============================================================================

// // let gl = null;
// // let xrSession = null;
// // let xrReferenceSpace = null;

// // let simpleProgram = null;

// // let cubeBuffer = null;
// // let cubeColorBuffer = null; // NEW: Random colors for each cube instance
// // let indexBuffer = null;
// // let instanceBuffer = null;
// // let instanceCount = 0;
// // let quadBuffer = null;

// // // NEW: Plane geometry buffers
// // let planeVertexBuffer = null;
// // let planeIndexBuffer = null;
// // let planeColorBuffers = []; // One color buffer per plane

// // let drawBuffersExt = null;
// // let instancingExt = null;

// // let approxProgram = null;
// // let approxCompositeProgram = null;

// // let leftEyeApproxTextures = {
// //     accumTexture: null,
// //     revealTexture: null,
// //     framebuffer: null
// // };

// // let rightEyeApproxTextures = {
// //     accumTexture: null,
// //     revealTexture: null,
// //     framebuffer: null
// // };

// // const ALPHA = 0.5; // Reduced from 0.8 to prevent white center 

// // let vrButton = null;
// // let statusDiv = null;

// // function updateStatus(message) {
// //     console.log(message);
// //     if (statusDiv) {
// //         statusDiv.textContent = message;
// //     }
// // }

// // // ============================================================================
// // // INITIALIZATION
// // // ============================================================================

// // function initGL() {
// //     const canvas = document.createElement('canvas');
    
// //     gl = canvas.getContext('webgl', { 
// //         xrCompatible: true,
// //         antialias: false,
// //         alpha: false
// //     });
    
// //     if (!gl) {
// //         updateStatus('Failed to get WebGL context');
// //         return false;
// //     }

// //     drawBuffersExt = gl.getExtension('WEBGL_draw_buffers');
// //     if (!drawBuffersExt) {
// //         updateStatus('WEBGL_draw_buffers not supported - using simple transparency');
// //     }

// //     instancingExt = gl.getExtension('ANGLE_instanced_arrays');
// //     if (!instancingExt) {
// //         updateStatus('Instanced rendering not supported');
// //         return false;
// //     }

// //     simpleProgram = createProgram(gl, APPROX_VS, SIMPLE_FS);
// //     if (!simpleProgram) {
// //         updateStatus('Failed to create fallback shader program');
// //         return false;
// //     }

// //     if (drawBuffersExt) {
// //         approxProgram = createProgram(gl, APPROX_VS, APPROX_FS);
// //         approxCompositeProgram = createProgram(gl, APPROX_COMPOSITE_VS, APPROX_COMPOSITE_FS);
        
// //         if (approxProgram && approxCompositeProgram) {
// //             updateStatus('Approximate alpha blending available');
// //         } else {
// //             updateStatus('Failed to create approx programs - using fallback');
// //             drawBuffersExt = null;
// //         }
// //     }

// //     cubeBuffer = gl.createBuffer();
// //     gl.bindBuffer(gl.ARRAY_BUFFER, cubeBuffer);
// //     gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

// //     indexBuffer = gl.createBuffer();
// //     gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
// //     gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);

// //     const maxInstances = 1000;
// //     const instancePositions = new Float32Array(maxInstances * 3);
// //     const instanceColors = new Float32Array(maxInstances * 3); // NEW: Random colors
// //     let idx = 0;
    
// //     // Color palette - more saturated colors
// //     const colorPalette = [
// //         [1, 0, 0],    // Red
// //         [0, 1, 0],    // Green
// //         [0, 0, 1],    // Blue
// //         [1, 1, 0],    // Yellow
// //         [1, 0, 1],    // Magenta
// //         [0, 1, 1],    // Cyan
// //         [1, 0.5, 0],  // Orange
// //         [0.5, 0, 1],  // Purple
// //     ];
    
// //     for (let x = 0; x < 10; x++) {
// //         for (let y = 0; y < 10; y++) {
// //             for (let z = 0; z < 10; z++) {
// //                 const dx = x - 4.5, dy = y - 4.5, dz = z - 4.5;
// //                 const distSq = dx*dx + dy*dy + dz*dz;
// //                 if (distSq < 5*5) {
// //                     instancePositions[idx] = x * cubeSize;
// //                     instancePositions[idx + 1] = y * cubeSize;
// //                     instancePositions[idx + 2] = z * cubeSize - 3;
                    
// //                     // Pick a random color from palette
// //                     const color = colorPalette[Math.floor(Math.random() * colorPalette.length)];
// //                     instanceColors[idx] = color[0];
// //                     instanceColors[idx + 1] = color[1];
// //                     instanceColors[idx + 2] = color[2];
                    
// //                     idx += 3;
// //                 }
// //             }
// //         }
// //     }
    
// //     instanceCount = idx / 3;
    
// //     console.log(`Generated ${instanceCount} cubes with random colors`);
// //     console.log(`First 3 cube colors:`, 
// //         instanceColors.slice(0, 3),
// //         instanceColors.slice(3, 6),
// //         instanceColors.slice(6, 9)
// //     );
    
// //     instanceBuffer = gl.createBuffer();
// //     gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuffer);
// //     gl.bufferData(gl.ARRAY_BUFFER, instancePositions.subarray(0, idx), gl.STATIC_DRAW);
    
// //     // NEW: Create color buffer for cube instances
// //     cubeColorBuffer = gl.createBuffer();
// //     gl.bindBuffer(gl.ARRAY_BUFFER, cubeColorBuffer);
// //     gl.bufferData(gl.ARRAY_BUFFER, instanceColors.subarray(0, idx), gl.STATIC_DRAW);

// //     // NEW: Create plane geometry (1m x 1m square centered at origin)
// //     const planeSize = 0.5; // Half-size for centering
// //     const planeVertices = new Float32Array([
// //         // Position (x, y, z) - quad in XY plane
// //         -planeSize, -planeSize, 0.0,
// //          planeSize, -planeSize, 0.0,
// //          planeSize,  planeSize, 0.0,
// //         -planeSize,  planeSize, 0.0
// //     ]);
    
// //     const planeIndices = new Uint16Array([
// //         0, 1, 2,
// //         0, 2, 3
// //     ]);
    
// //     planeVertexBuffer = gl.createBuffer();
// //     gl.bindBuffer(gl.ARRAY_BUFFER, planeVertexBuffer);
// //     gl.bufferData(gl.ARRAY_BUFFER, planeVertices, gl.STATIC_DRAW);
    
// //     planeIndexBuffer = gl.createBuffer();
// //     gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, planeIndexBuffer);
// //     gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, planeIndices, gl.STATIC_DRAW);
    
// //     // Create color buffers for each plane (red, green, blue)
// //     const planeColors = [
// //         new Float32Array([1, 0, 0,  1, 0, 0,  1, 0, 0,  1, 0, 0]), // Red
// //         new Float32Array([0, 1, 0,  0, 1, 0,  0, 1, 0,  0, 1, 0]), // Green
// //         new Float32Array([0, 0, 1,  0, 0, 1,  0, 0, 1,  0, 0, 1])  // Blue
// //     ];
    
// //     for (let i = 0; i < planeColors.length; i++) {
// //         const colorBuffer = gl.createBuffer();
// //         gl.bindBuffer(gl.ARRAY_BUFFER, colorBuffer);
// //         gl.bufferData(gl.ARRAY_BUFFER, planeColors[i], gl.STATIC_DRAW);
// //         planeColorBuffers.push(colorBuffer);
// //     }

// //     const quadVertices = new Float32Array([
// //         -1, -1,
// //          1, -1,
// //         -1,  1,
// //          1,  1
// //     ]);
    
// //     quadBuffer = gl.createBuffer();
// //     gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
// //     gl.bufferData(gl.ARRAY_BUFFER, quadVertices, gl.STATIC_DRAW);

// //     gl.clearColor(0.1, 0.1, 0.2, 1.0);
// //     gl.disable(gl.DEPTH_TEST);
// //     gl.enable(gl.BLEND);

// //     updateStatus('WebGL initialized with approximate alpha blending');
// //     return true;
// // }

// // // ============================================================================
// // // APPROXIMATE BLENDING SETUP
// // // ============================================================================

// // function createApproxFramebuffer(gl, accumTexture, revealTexture) {
// //     const fb = gl.createFramebuffer();
// //     gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    
// //     gl.framebufferTexture2D(
// //         gl.FRAMEBUFFER,
// //         drawBuffersExt.COLOR_ATTACHMENT0_WEBGL,
// //         gl.TEXTURE_2D,
// //         accumTexture,
// //         0
// //     );
    
// //     gl.framebufferTexture2D(
// //         gl.FRAMEBUFFER,
// //         drawBuffersExt.COLOR_ATTACHMENT1_WEBGL,
// //         gl.TEXTURE_2D,
// //         revealTexture,
// //         0
// //     );
    
// //     const depthBuffer = gl.createRenderbuffer();
// //     gl.bindRenderbuffer(gl.RENDERBUFFER, depthBuffer);
// //     gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, 
// //                           accumTexture.width, accumTexture.height);
// //     gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, 
// //                               gl.RENDERBUFFER, depthBuffer);
    
// //     const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
// //     if (status !== gl.FRAMEBUFFER_COMPLETE) {
// //         console.error('Framebuffer incomplete:', status);
// //         return null;
// //     }
    
// //     gl.bindFramebuffer(gl.FRAMEBUFFER, null);
// //     return fb;
// // }

// // function setupApproxTextures(textureSet, width, height) {
// //     if (textureSet.framebuffer) {
// //         gl.deleteTexture(textureSet.accumTexture);
// //         gl.deleteTexture(textureSet.revealTexture);
// //         gl.deleteFramebuffer(textureSet.framebuffer);
// //     }
    
// //     textureSet.accumTexture = createTexture(gl, width, height, gl.RGBA, gl.UNSIGNED_BYTE);
// //     textureSet.revealTexture = createTexture(gl, width, height, gl.RGBA, gl.UNSIGNED_BYTE);
    
// //     textureSet.framebuffer = createApproxFramebuffer(
// //         gl, 
// //         textureSet.accumTexture, 
// //         textureSet.revealTexture
// //     );
// // }

// // // ============================================================================
// // // RENDERING
// // // ============================================================================

// // function renderCubes(projMatrix, viewMatrix, modelMatrix, program) {
// //     gl.useProgram(program);
    
// //     const projLoc = gl.getUniformLocation(program, 'u_projectionMatrix');
// //     const viewLoc = gl.getUniformLocation(program, 'u_viewMatrix');
// //     const modelLoc = gl.getUniformLocation(program, 'u_modelMatrix');
// //     const useVertexColorLoc = gl.getUniformLocation(program, 'u_useVertexColor');
    
// //     gl.uniformMatrix4fv(projLoc, false, projMatrix);
// //     gl.uniformMatrix4fv(viewLoc, false, viewMatrix);
// //     gl.uniformMatrix4fv(modelLoc, false, modelMatrix);
    
// //     // NEW: Use vertex colors for cubes now
// //     if (useVertexColorLoc !== null) {
// //         gl.uniform1i(useVertexColorLoc, 1);
// //     }
    
// //     const posLoc = gl.getAttribLocation(program, 'a_position');
// //     const instPosLoc = gl.getAttribLocation(program, 'a_instancePosition');
// //     const colorLoc = gl.getAttribLocation(program, 'a_color');
    
// //     // Debug: Log attribute locations once
// //     if (!renderCubes.logged) {
// //         console.log('Cube render attributes:', { posLoc, instPosLoc, colorLoc, useVertexColorLoc });
// //         renderCubes.logged = true;
// //     }
    
// //     gl.bindBuffer(gl.ARRAY_BUFFER, cubeBuffer);
// //     gl.vertexAttribPointer(posLoc, 3, gl.FLOAT, false, 0, 0);
// //     gl.enableVertexAttribArray(posLoc);
// //     instancingExt.vertexAttribDivisorANGLE(posLoc, 0);
    
// //     gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuffer);
// //     gl.vertexAttribPointer(instPosLoc, 3, gl.FLOAT, false, 0, 0);
// //     gl.enableVertexAttribArray(instPosLoc);
// //     instancingExt.vertexAttribDivisorANGLE(instPosLoc, 1);
    
// //     // NEW: Enable per-instance colors
// //     if (colorLoc >= 0) {
// //         gl.bindBuffer(gl.ARRAY_BUFFER, cubeColorBuffer);
// //         gl.vertexAttribPointer(colorLoc, 3, gl.FLOAT, false, 0, 0);
// //         gl.enableVertexAttribArray(colorLoc);
// //         instancingExt.vertexAttribDivisorANGLE(colorLoc, 1); // One color per instance
// //     } else {
// //         console.warn('Color attribute location is invalid:', colorLoc);
// //     }
    
// //     gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    
// //     instancingExt.drawElementsInstancedANGLE(
// //         gl.TRIANGLES, 
// //         36, 
// //         gl.UNSIGNED_SHORT, 
// //         0, 
// //         instanceCount
// //     );
// // }

// // // NEW: Render test planes at different depths
// // function renderTestPlanes(projMatrix, viewMatrix, program) {
// //     gl.useProgram(program);
    
// //     const projLoc = gl.getUniformLocation(program, 'u_projectionMatrix');
// //     const viewLoc = gl.getUniformLocation(program, 'u_viewMatrix');
// //     const modelLoc = gl.getUniformLocation(program, 'u_modelMatrix');
// //     const alphaLoc = gl.getUniformLocation(program, 'u_alpha');
// //     const useVertexColorLoc = gl.getUniformLocation(program, 'u_useVertexColor');
    
// //     gl.uniformMatrix4fv(projLoc, false, projMatrix);
// //     gl.uniformMatrix4fv(viewLoc, false, viewMatrix);
    
// //     // Use vertex colors for planes
// //     if (useVertexColorLoc !== null) {
// //         gl.uniform1i(useVertexColorLoc, 1);
// //     }
    
// //     const posLoc = gl.getAttribLocation(program, 'a_position');
// //     const instPosLoc = gl.getAttribLocation(program, 'a_instancePosition');
// //     const colorLoc = gl.getAttribLocation(program, 'a_color');
    
// //     gl.bindBuffer(gl.ARRAY_BUFFER, planeVertexBuffer);
// //     gl.vertexAttribPointer(posLoc, 3, gl.FLOAT, false, 0, 0);
// //     gl.enableVertexAttribArray(posLoc);
    

// //     if (instPosLoc >= 0) {
// //         gl.disableVertexAttribArray(instPosLoc);
// //         gl.vertexAttrib3f(instPosLoc, 0, 0, 0);
// //         instancingExt.vertexAttribDivisorANGLE(instPosLoc, 0);
// //     }
    
// //     gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, planeIndexBuffer);
    
// //     const planes = [
// //         { z: -2.0, alpha: 0.2, colorBufferIndex: 0 }, 
// //         { z: -3.0, alpha: 0.4, colorBufferIndex: 1 }, 
// //         { z: -4.0, alpha: 0.4, colorBufferIndex: 2 }   
// //     ];
    
// //     for (const plane of planes) {

// //         const modelMatrix = new Float32Array([
// //             1, 0, 0, 0,
// //             0, 1, 0, 0,
// //             0, 0, 1, 0,
// //             0, 0, plane.z, 1
// //         ]);
        
// //         gl.uniformMatrix4fv(modelLoc, false, modelMatrix);
        
// //         gl.uniform1f(alphaLoc, plane.alpha);
        
// //         if (colorLoc >= 0) {
// //             gl.bindBuffer(gl.ARRAY_BUFFER, planeColorBuffers[plane.colorBufferIndex]);
// //             gl.vertexAttribPointer(colorLoc, 3, gl.FLOAT, false, 0, 0);
// //             gl.enableVertexAttribArray(colorLoc);
// //         }
        
// //         gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
// //     }
// // }

// // function drawSceneWithApproxBlending(view) {
// //     const viewport = xrSession.renderState.baseLayer.getViewport(view);
// //     const width = Math.floor(viewport.width);
// //     const height = Math.floor(viewport.height);
// //     const x = Math.floor(viewport.x);
// //     const y = Math.floor(viewport.y);
    
// //     if (width <= 0 || height <= 0) return;
    
// //     const isLeftEye = viewport.x === 0;
// //     const textureSet = isLeftEye ? leftEyeApproxTextures : rightEyeApproxTextures;
    
// //     const modelMatrix = new Float32Array([
// //         1, 0, 0, 0,
// //         0, 1, 0, 0,
// //         0, 0, 1, 0,
// //         0, 0, 0, 1
// //     ]);
    
// //     if (!drawBuffersExt || !approxProgram || !approxCompositeProgram) {
// //         gl.bindFramebuffer(gl.FRAMEBUFFER, xrSession.renderState.baseLayer.framebuffer);
// //         gl.viewport(x, y, width, height);
// //         gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
// //         renderCubes(view.projectionMatrix, view.transform.inverse.matrix, modelMatrix, simpleProgram);

// //         renderTestPlanes(view.projectionMatrix, view.transform.inverse.matrix, simpleProgram);
// //         console.log('rendering in fallback mode')
// //         return;
// //     }
    
// //     const needsRecreation = !textureSet.accumTexture || 
// //                            textureSet.accumTexture.width !== width ||
// //                            textureSet.accumTexture.height !== height;
    
// //     if (needsRecreation) {
// //         console.log(`Creating approx ${isLeftEye ? 'LEFT' : 'RIGHT'} eye textures: ${width}x${height}`);
// //         setupApproxTextures(textureSet, width, height);
// //     }
    
// //     gl.bindFramebuffer(gl.FRAMEBUFFER, textureSet.framebuffer);
// //     gl.viewport(0, 0, width, height);
    
// //     drawBuffersExt.drawBuffersWEBGL([
// //         drawBuffersExt.COLOR_ATTACHMENT0_WEBGL,
// //         drawBuffersExt.COLOR_ATTACHMENT1_WEBGL
// //     ]);
    
// //     gl.clearColor(0.0, 0.0, 0.0, 0.0);
// //     gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    
// //     gl.enable(gl.BLEND);
// //     gl.blendEquation(gl.FUNC_ADD);
// //     gl.blendFunc(gl.ONE, gl.ONE); 
// //     gl.blendFuncSeparate(gl.ONE, gl.ONE,  
// //                      gl.ZERO, gl.ONE_MINUS_SRC_ALPHA); 
    
// //     gl.depthMask(false); 
// //     gl.enable(gl.DEPTH_TEST); 
// //     gl.depthFunc(gl.LESS);
    
// //     gl.useProgram(approxProgram);
// //     const alphaLoc = gl.getUniformLocation(approxProgram, 'u_alpha');
    
// //     // Debug: Log alpha value being used (only once)
// //     if (!drawSceneWithApproxBlending.loggedAlpha) {
// //         console.log('ALPHA constant:', ALPHA);
// //         console.log('Alpha uniform location:', alphaLoc);
// //         drawSceneWithApproxBlending.loggedAlpha = true;
// //     }
    
// //     // Set alpha for cubes (planes will set their own per-plane alpha in renderTestPlanes)
// //     gl.uniform1f(alphaLoc, ALPHA);
    
// //     // renderCubes(view.projectionMatrix, view.transform.inverse.matrix, 
// //     //             modelMatrix, approxProgram);
    
// //     // NEW: Render test planes with approximate blending
// //     renderTestPlanes(view.projectionMatrix, view.transform.inverse.matrix, approxProgram);
    
// //     // === COMPOSITE PASS ===
// //     gl.bindFramebuffer(gl.FRAMEBUFFER, xrSession.renderState.baseLayer.framebuffer);
// //     gl.viewport(x, y, width, height);
    
// //     // Clear to background color first
// //     gl.clearColor(0.7, 0.7, 0.85, 1.0);
// //     gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    
// //     // Setup blending for final composite
// //     gl.enable(gl.BLEND);
// //     gl.blendFunc(gl.ONE_MINUS_SRC_ALPHA, gl.SRC_ALPHA);
// //     gl.disable(gl.DEPTH_TEST);
// //     gl.depthMask(true);
    
// //     gl.useProgram(approxCompositeProgram);
    
// //     const accumLoc = gl.getUniformLocation(approxCompositeProgram, 'u_accumTexture');
// //     const revealLoc = gl.getUniformLocation(approxCompositeProgram, 'u_revealTexture');
    
// //     gl.activeTexture(gl.TEXTURE0);
// //     gl.bindTexture(gl.TEXTURE_2D, textureSet.accumTexture);
// //     gl.uniform1i(accumLoc, 0);
    
// //     gl.activeTexture(gl.TEXTURE1);
// //     gl.bindTexture(gl.TEXTURE_2D, textureSet.revealTexture);
// //     gl.uniform1i(revealLoc, 1);
    
// //     gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
// //     const posLoc = gl.getAttribLocation(approxCompositeProgram, 'a_position');
// //     gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);
// //     gl.enableVertexAttribArray(posLoc);
    
// //     gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    
// //     gl.enable(gl.DEPTH_TEST);
// // }

// // // ============================================================================
// // // XR FUNCTIONS
// // // ============================================================================

// // function onXRFrame(time, frame) {
// //     if (!xrSession) return;
    
// //     xrSession.requestAnimationFrame(onXRFrame);

// //     const pose = frame.getViewerPose(xrReferenceSpace);
// //     if (!pose) return;

// //     const glLayer = xrSession.renderState.baseLayer;
// //     gl.bindFramebuffer(gl.FRAMEBUFFER, glLayer.framebuffer);
    
// //     gl.clearColor(1.0, 1.0, 1.0, 1);
// //     gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    
// //     for (const view of pose.views) {
// //         drawSceneWithApproxBlending(view);
// //     }
// // }

// // async function enterVR() {
// //     if (xrSession) {
// //         xrSession.end();
// //         return;
// //     }

// //     try {
// //         updateStatus('Requesting VR session...');
        
// //         const session = await navigator.xr.requestSession('immersive-vr');
// //         xrSession = session;
        
// //         updateStatus('VR session started');
// //         vrButton.textContent = 'Exit VR';

// //         session.addEventListener('end', () => {
// //             updateStatus('VR session ended');
// //             xrSession = null;
// //             xrReferenceSpace = null;
// //             vrButton.textContent = 'Enter VR';
// //         });

// //         await gl.makeXRCompatible();
        
// //         const xrLayer = new XRWebGLLayer(session, gl);
// //         await session.updateRenderState({ baseLayer: xrLayer });

// //         xrReferenceSpace = await session.requestReferenceSpace('local');
// //         updateStatus('Transparent cubes + test planes rendering with approximate alpha blending');
        
// //         session.requestAnimationFrame(onXRFrame);

// //     } catch (error) {
// //         updateStatus(`VR Error: ${error.message}`);
// //         console.error('VR session error:', error);
// //         if (xrSession) {
// //             xrSession.end();
// //             xrSession = null;
// //         }
// //     }
// // }

// // // ============================================================================
// // // STARTUP
// // // ============================================================================

// // window.addEventListener('load', async () => {
// //     vrButton = document.getElementById('vr-button');
// //     statusDiv = document.getElementById('status');

// //     if (!vrButton || !statusDiv) {
// //         updateStatus('Missing HTML elements');
// //         return;
// //     }

// //     if (!initGL()) {
// //         updateStatus('WebGL initialization failed');
// //         return;
// //     }

// //     if (!navigator.xr) {
// //         updateStatus('WebXR not supported');
// //         return;
// //     }

// //     try {
// //         const supported = await navigator.xr.isSessionSupported('immersive-vr');
// //         if (supported) {
// //             updateStatus('VR supported - click Enter VR');
// //             vrButton.disabled = false;
// //             vrButton.addEventListener('click', enterVR);
// //         } else {
// //             updateStatus('VR not supported on this device');
// //         }
// //     } catch (error) {
// //         updateStatus(`Error checking VR support: ${error.message}`);
// //     }
// // });
// import { cubeSize, indices, vertices } from "./cube.js";
// import { APPROX_COMPOSITE_FS, APPROX_COMPOSITE_VS, APPROX_FS, APPROX_VS } from "./shaders.js";

// const SIMPLE_FS = `
//     precision highp float;
    
//     uniform int u_useVertexColor;
    
//     varying vec3 v_position;
//     varying vec3 v_normal;
//     varying vec3 v_color;
    
//     void main() {
//         // Simple lighting
//         vec3 lightDir = normalize(vec3(0.5, 0.5, -1.0));
//         vec3 normal = normalize(v_normal);
//         float diff = max(dot(normal, lightDir), 0.0) * 0.6 + 0.4;
        
//         // Color: use vertex color if available, otherwise position-based
//         vec3 color;
//         if (u_useVertexColor == 1) {
//             color = v_color * diff;
//         } else {
//             color = abs(normalize(v_position)) * diff;
//         }
        
//         gl_FragColor = vec4(color, 0.3); // Semi-transparent
//     }
// `;

// // ============================================================================
// // UTILITY FUNCTIONS
// // ============================================================================

// function compileShader(gl, source, type) {
//     const shader = gl.createShader(type);
//     gl.shaderSource(shader, source);
//     gl.compileShader(shader);
//     if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
//         console.error('Shader compile error:', gl.getShaderInfoLog(shader));
//         gl.deleteShader(shader);
//         return null;
//     }
//     return shader;
// }

// function createProgram(gl, vsSource, fsSource) {
//     const vertexShader = compileShader(gl, vsSource, gl.VERTEX_SHADER);
//     const fragmentShader = compileShader(gl, fsSource, gl.FRAGMENT_SHADER);
//     if (!vertexShader || !fragmentShader) return null;
    
//     const program = gl.createProgram();
//     gl.attachShader(program, vertexShader);
//     gl.attachShader(program, fragmentShader);
//     gl.linkProgram(program);
    
//     if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
//         console.error('Program link error:', gl.getProgramInfoLog(program));
//         gl.deleteProgram(program);
//         return null;
//     }
//     return program;
// }

// function createTexture(gl, width, height, format, type) {
//     width = Math.floor(width);
//     height = Math.floor(height);
    
//     const texture = gl.createTexture();
//     gl.bindTexture(gl.TEXTURE_2D, texture);
//     gl.texImage2D(gl.TEXTURE_2D, 0, format, width, height, 0, format, type, null);
//     gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
//     gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
//     gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
//     gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
//     gl.bindTexture(gl.TEXTURE_2D, null);
    
//     texture.width = width;
//     texture.height = height;
    
//     return texture;
// }

// // ============================================================================
// // GLOBAL STATE
// // ============================================================================

// let gl = null;
// let xrSession = null;
// let xrReferenceSpace = null;

// let simpleProgram = null;

// let cubeBuffer = null;
// let cubeColorBuffer = null; 
// let indexBuffer = null;
// let instanceBuffer = null;
// let instanceCount = 0;
// let quadBuffer = null;

// // NEW: Plane geometry buffers
// let planeVertexBuffer = null;
// let planeIndexBuffer = null;
// let planeColorBuffers = []; 

// let drawBuffersExt = null;
// let instancingExt = null;

// let approxProgram = null;
// let approxCompositeProgram = null;

// let leftEyeApproxTextures = {
//     accumTexture: null,
//     revealTexture: null,
//     framebuffer: null
// };

// let rightEyeApproxTextures = {
//     accumTexture: null,
//     revealTexture: null,
//     framebuffer: null
// };

// const ALPHA = 0.5; 

// let vrButton = null;
// let statusDiv = null;

// function updateStatus(message) {
//     console.log(message);
//     if (statusDiv) {
//         statusDiv.textContent = message;
//     }
// }

// // ============================================================================
// // INITIALIZATION
// // ============================================================================

// function initGL() {
//     const canvas = document.createElement('canvas');
    
//     gl = canvas.getContext('webgl', { 
//         xrCompatible: true,
//         antialias: false,
//         alpha: false
//     });
    
//     if (!gl) {
//         updateStatus('Failed to get WebGL context');
//         return false;
//     }

//     drawBuffersExt = gl.getExtension('WEBGL_draw_buffers');
//     if (!drawBuffersExt) {
//         updateStatus('WEBGL_draw_buffers not supported - using simple transparency');
//     }

//     instancingExt = gl.getExtension('ANGLE_instanced_arrays');
//     if (!instancingExt) {
//         updateStatus('Instanced rendering not supported');
//         return false;
//     }

//     simpleProgram = createProgram(gl, APPROX_VS, SIMPLE_FS);
//     if (!simpleProgram) {
//         updateStatus('Failed to create fallback shader program');
//         return false;
//     }

//     if (drawBuffersExt) {
//         approxProgram = createProgram(gl, APPROX_VS, APPROX_FS);
//         approxCompositeProgram = createProgram(gl, APPROX_COMPOSITE_VS, APPROX_COMPOSITE_FS);
        
//         if (approxProgram && approxCompositeProgram) {
//             updateStatus('Approximate alpha blending available');
//         } else {
//             updateStatus('Failed to create approx programs - using fallback');
//             drawBuffersExt = null;
//         }
//     }

//     cubeBuffer = gl.createBuffer();
//     gl.bindBuffer(gl.ARRAY_BUFFER, cubeBuffer);
//     gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

//     indexBuffer = gl.createBuffer();
//     gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
//     gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);

//     const maxInstances = 1000;
//     const instancePositions = new Float32Array(maxInstances * 3);
//     const instanceColors = new Float32Array(maxInstances * 3); // NEW: Random colors
//     let idx = 0;
    
//     const colorPalette = [
//         [1, 0, 0],    
//         [0, 1, 0],    
//         [0, 0, 1],   
//     ];
    
//     for (let x = 0; x < 10; x++) {
//         for (let y = 0; y < 10; y++) {
//             for (let z = 0; z < 10; z++) {
//                 const dx = x - 4.5, dy = y - 4.5, dz = z - 4.5;
//                 const distSq = dx*dx + dy*dy + dz*dz;
//                 if (distSq < 5*5) {
//                     instancePositions[idx] = x * cubeSize;
//                     instancePositions[idx + 1] = y * cubeSize;
//                     instancePositions[idx + 2] = z * cubeSize - 3;
                    
//                     const color = colorPalette[Math.floor(Math.random() * colorPalette.length)];
//                     instanceColors[idx] = color[0];
//                     instanceColors[idx + 1] = color[1];
//                     instanceColors[idx + 2] = color[2];
                    
//                     idx += 3;
//                 }
//             }
//         }
//     }
    
//     instanceCount = idx / 3;
    
//     console.log(`Generated ${instanceCount} cubes with random colors`);
//     console.log(`First 3 cube colors:`, 
//         instanceColors.slice(0, 3),
//         instanceColors.slice(3, 6),
//         instanceColors.slice(6, 9)
//     );
    
//     instanceBuffer = gl.createBuffer();
//     gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuffer);
//     gl.bufferData(gl.ARRAY_BUFFER, instancePositions.subarray(0, idx), gl.STATIC_DRAW);
    
//     cubeColorBuffer = gl.createBuffer();
//     gl.bindBuffer(gl.ARRAY_BUFFER, cubeColorBuffer);
//     gl.bufferData(gl.ARRAY_BUFFER, instanceColors.subarray(0, idx), gl.STATIC_DRAW);

//     const planeSize = 0.5; 
//     const planeVertices = new Float32Array([
//         -planeSize, -planeSize, 0.0,
//          planeSize, -planeSize, 0.0,
//          planeSize,  planeSize, 0.0,
//         -planeSize,  planeSize, 0.0
//     ]);
    
//     const planeIndices = new Uint16Array([
//         0, 1, 2,
//         0, 2, 3
//     ]);
    
//     planeVertexBuffer = gl.createBuffer();
//     gl.bindBuffer(gl.ARRAY_BUFFER, planeVertexBuffer);
//     gl.bufferData(gl.ARRAY_BUFFER, planeVertices, gl.STATIC_DRAW);
    
//     planeIndexBuffer = gl.createBuffer();
//     gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, planeIndexBuffer);
//     gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, planeIndices, gl.STATIC_DRAW);
    
//     const planeColors = [
//         new Float32Array([1, 0, 0,  1, 0, 0,  1, 0, 0,  1, 0, 0]), 
//         new Float32Array([0, 1, 0,  0, 1, 0,  0, 1, 0,  0, 1, 0]), 
//         new Float32Array([0, 0, 1,  0, 0, 1,  0, 0, 1,  0, 0, 1])  
//     ];
    
//     for (let i = 0; i < planeColors.length; i++) {
//         const colorBuffer = gl.createBuffer();
//         gl.bindBuffer(gl.ARRAY_BUFFER, colorBuffer);
//         gl.bufferData(gl.ARRAY_BUFFER, planeColors[i], gl.STATIC_DRAW);
//         planeColorBuffers.push(colorBuffer);
//     }

//     const quadVertices = new Float32Array([
//         -1, -1,
//          1, -1,
//         -1,  1,
//          1,  1
//     ]);
    
//     quadBuffer = gl.createBuffer();
//     gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
//     gl.bufferData(gl.ARRAY_BUFFER, quadVertices, gl.STATIC_DRAW);

//     gl.clearColor(0.1, 0.1, 0.2, 1.0);
//     gl.disable(gl.DEPTH_TEST);
//     gl.enable(gl.BLEND);

//     updateStatus('WebGL initialized with approximate alpha blending');
//     return true;
// }

// // ============================================================================
// // APPROXIMATE BLENDING SETUP
// // ============================================================================

// function createApproxFramebuffer(gl, accumTexture, revealTexture) {
//     const fb = gl.createFramebuffer();
//     gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    
//     gl.framebufferTexture2D(
//         gl.FRAMEBUFFER,
//         drawBuffersExt.COLOR_ATTACHMENT0_WEBGL,
//         gl.TEXTURE_2D,
//         accumTexture,
//         0
//     );
    
//     gl.framebufferTexture2D(
//         gl.FRAMEBUFFER,
//         drawBuffersExt.COLOR_ATTACHMENT1_WEBGL,
//         gl.TEXTURE_2D,
//         revealTexture,
//         0
//     );
    
//     const depthBuffer = gl.createRenderbuffer();
//     gl.bindRenderbuffer(gl.RENDERBUFFER, depthBuffer);
//     gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, 
//                           accumTexture.width, accumTexture.height);
//     gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, 
//                               gl.RENDERBUFFER, depthBuffer);
    
//     const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
//     if (status !== gl.FRAMEBUFFER_COMPLETE) {
//         console.error('Framebuffer incomplete:', status);
//         return null;
//     }
    
//     gl.bindFramebuffer(gl.FRAMEBUFFER, null);
//     return fb;
// }

// function setupApproxTextures(textureSet, width, height) {
//     if (textureSet.framebuffer) {
//         gl.deleteTexture(textureSet.accumTexture);
//         gl.deleteTexture(textureSet.revealTexture);
//         gl.deleteFramebuffer(textureSet.framebuffer);
//     }
    
//     textureSet.accumTexture = createTexture(gl, width, height, gl.RGBA, gl.UNSIGNED_BYTE);
//     textureSet.revealTexture = createTexture(gl, width, height, gl.RGBA, gl.UNSIGNED_BYTE);
    
//     textureSet.framebuffer = createApproxFramebuffer(
//         gl, 
//         textureSet.accumTexture, 
//         textureSet.revealTexture
//     );
// }

// // ============================================================================
// // RENDERING
// // ============================================================================

// function renderCubes(projMatrix, viewMatrix, modelMatrix, program) {
//     gl.useProgram(program);
    
//     const projLoc = gl.getUniformLocation(program, 'u_projectionMatrix');
//     const viewLoc = gl.getUniformLocation(program, 'u_viewMatrix');
//     const modelLoc = gl.getUniformLocation(program, 'u_modelMatrix');
//     const useVertexColorLoc = gl.getUniformLocation(program, 'u_useVertexColor');
    
//     gl.uniformMatrix4fv(projLoc, false, projMatrix);
//     gl.uniformMatrix4fv(viewLoc, false, viewMatrix);
//     gl.uniformMatrix4fv(modelLoc, false, modelMatrix);
    
//     if (useVertexColorLoc !== null) {
//         gl.uniform1i(useVertexColorLoc, 1);
//     }
    
//     const posLoc = gl.getAttribLocation(program, 'a_position');
//     const instPosLoc = gl.getAttribLocation(program, 'a_instancePosition');
//     const colorLoc = gl.getAttribLocation(program, 'a_color');
    
//     if (!renderCubes.logged) {
//         console.log('Cube render attributes:', { posLoc, instPosLoc, colorLoc, useVertexColorLoc });
//         renderCubes.logged = true;
//     }
    
//     gl.bindBuffer(gl.ARRAY_BUFFER, cubeBuffer);
//     gl.vertexAttribPointer(posLoc, 3, gl.FLOAT, false, 0, 0);
//     gl.enableVertexAttribArray(posLoc);
//     instancingExt.vertexAttribDivisorANGLE(posLoc, 0);
    
//     gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuffer);
//     gl.vertexAttribPointer(instPosLoc, 3, gl.FLOAT, false, 0, 0);
//     gl.enableVertexAttribArray(instPosLoc);
//     instancingExt.vertexAttribDivisorANGLE(instPosLoc, 1);
    
//     if (colorLoc >= 0) {
//         gl.bindBuffer(gl.ARRAY_BUFFER, cubeColorBuffer);
//         gl.vertexAttribPointer(colorLoc, 3, gl.FLOAT, false, 0, 0);
//         gl.enableVertexAttribArray(colorLoc);
//         instancingExt.vertexAttribDivisorANGLE(colorLoc, 1); 
//     } else {
//         console.warn('Color attribute location is invalid:', colorLoc);
//     }
    
//     gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    
//     instancingExt.drawElementsInstancedANGLE(
//         gl.TRIANGLES, 
//         36, 
//         gl.UNSIGNED_SHORT, 
//         0, 
//         instanceCount
//     );
// }

// function renderTestPlanes(projMatrix, viewMatrix, program) {
//     gl.useProgram(program);
    
//     const projLoc = gl.getUniformLocation(program, 'u_projectionMatrix');
//     const viewLoc = gl.getUniformLocation(program, 'u_viewMatrix');
//     const modelLoc = gl.getUniformLocation(program, 'u_modelMatrix');
//     const alphaLoc = gl.getUniformLocation(program, 'u_alpha');
//     const useVertexColorLoc = gl.getUniformLocation(program, 'u_useVertexColor');
    
//     gl.uniformMatrix4fv(projLoc, false, projMatrix);
//     gl.uniformMatrix4fv(viewLoc, false, viewMatrix);
    
//     if (useVertexColorLoc !== null) {
//         gl.uniform1i(useVertexColorLoc, 1);
//     }
    
//     const posLoc = gl.getAttribLocation(program, 'a_position');
//     const instPosLoc = gl.getAttribLocation(program, 'a_instancePosition');
//     const colorLoc = gl.getAttribLocation(program, 'a_color');
    
//     gl.bindBuffer(gl.ARRAY_BUFFER, planeVertexBuffer);
//     gl.vertexAttribPointer(posLoc, 3, gl.FLOAT, false, 0, 0);
//     gl.enableVertexAttribArray(posLoc);
    

//     if (instPosLoc >= 0) {
//         gl.disableVertexAttribArray(instPosLoc);
//         gl.vertexAttrib3f(instPosLoc, 0, 0, 0);
//         instancingExt.vertexAttribDivisorANGLE(instPosLoc, 0);
//     }
    
//     gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, planeIndexBuffer);
    
//     const time = Date.now() * 0.001;
    
//     const planes = [
//         { z: -1.5, alpha: 0.4, colorBufferIndex: 1, rotationOffset: Math.PI * 2 / 3, rotationSpeed: -1.2 }, 
//         { z: -1.0, alpha: 0.4, colorBufferIndex: 2, rotationOffset: 0, rotationSpeed: 0.8 }, 
//         { z: -2.0, alpha: 0.4, colorBufferIndex: 0, rotationOffset: Math.PI * 4 / 3, rotationSpeed: 0.5 }  ,
//     ];
    
//     for (const plane of planes) {
//         const angle = (time * plane.rotationSpeed) + plane.rotationOffset;
//         const cos = Math.cos(angle);
//         const sin = Math.sin(angle);
        
//         const modelMatrix = new Float32Array([
//             cos, -sin, 0, 0,
//             sin, cos, 0, 0,
//             0, 0, 1, 0,
//             0, 0, plane.z, 1
//         ]);
        
//         gl.uniformMatrix4fv(modelLoc, false, modelMatrix);
        
//         gl.uniform1f(alphaLoc, plane.alpha);
        
//         if (colorLoc >= 0) {
//             gl.bindBuffer(gl.ARRAY_BUFFER, planeColorBuffers[plane.colorBufferIndex]);
//             gl.vertexAttribPointer(colorLoc, 3, gl.FLOAT, false, 0, 0);
//             gl.enableVertexAttribArray(colorLoc);
//         }
        
//         gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
//     }
// }

// function drawSceneWithApproxBlending(view) {
//     const viewport = xrSession.renderState.baseLayer.getViewport(view);
//     const width = Math.floor(viewport.width);
//     const height = Math.floor(viewport.height);
//     const x = Math.floor(viewport.x);
//     const y = Math.floor(viewport.y);
    
//     if (width <= 0 || height <= 0) return;
    
//     const isLeftEye = viewport.x === 0;
//     const textureSet = isLeftEye ? leftEyeApproxTextures : rightEyeApproxTextures;
    
//     const modelMatrix = new Float32Array([
//         1, 0, 0, 0,
//         0, 1, 0, 0,
//         0, 0, 1, 0,
//         0, 0, 0, 1
//     ]);
    
//     if (!drawBuffersExt || !approxProgram || !approxCompositeProgram) {
//         gl.bindFramebuffer(gl.FRAMEBUFFER, xrSession.renderState.baseLayer.framebuffer);
//         gl.viewport(x, y, width, height);
//         gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
//         renderCubes(view.projectionMatrix, view.transform.inverse.matrix, modelMatrix, simpleProgram);

//         renderTestPlanes(view.projectionMatrix, view.transform.inverse.matrix, simpleProgram);
//         console.log('rendering in fallback mode')
//         return;
//     }
    
//     const needsRecreation = !textureSet.accumTexture || 
//                            textureSet.accumTexture.width !== width ||
//                            textureSet.accumTexture.height !== height;
    
//     if (needsRecreation) {
//         console.log(`Creating approx ${isLeftEye ? 'LEFT' : 'RIGHT'} eye textures: ${width}x${height}`);
//         setupApproxTextures(textureSet, width, height);
//     }
    
//     gl.bindFramebuffer(gl.FRAMEBUFFER, textureSet.framebuffer);
//     gl.viewport(0, 0, width, height);
    
//     drawBuffersExt.drawBuffersWEBGL([
//         drawBuffersExt.COLOR_ATTACHMENT0_WEBGL,
//         drawBuffersExt.COLOR_ATTACHMENT1_WEBGL
//     ]);
    
//     gl.clearColor(0.0, 0.0, 0.0, 0.0);
//     gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    
//     gl.enable(gl.BLEND);
//     gl.blendEquation(gl.FUNC_ADD);
//     gl.blendFunc(gl.ONE, gl.ONE); 
//     gl.blendFuncSeparate(gl.ONE, gl.ONE,  
//                      gl.ZERO, gl.ONE_MINUS_SRC_ALPHA); 
    
//     gl.depthMask(false); 
//     gl.enable(gl.DEPTH_TEST); 
//     gl.depthFunc(gl.LESS);
    
//     gl.useProgram(approxProgram);
//     const alphaLoc = gl.getUniformLocation(approxProgram, 'u_alpha');
    
//     if (!drawSceneWithApproxBlending.loggedAlpha) {
//         console.log('ALPHA constant:', ALPHA);
//         console.log('Alpha uniform location:', alphaLoc);
//         drawSceneWithApproxBlending.loggedAlpha = true;
//     }
    
//     gl.uniform1f(alphaLoc, ALPHA);
    
//     // renderCubes(view.projectionMatrix, view.transform.inverse.matrix, 
//     //             modelMatrix, approxProgram);
    
//     renderTestPlanes(view.projectionMatrix, view.transform.inverse.matrix, approxProgram);
    
//     gl.bindFramebuffer(gl.FRAMEBUFFER, xrSession.renderState.baseLayer.framebuffer);
//     gl.viewport(x, y, width, height);
    
//     gl.clearColor(0.7, 0.7, 0.85, 1.0);
//     gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    
//     gl.enable(gl.BLEND);
//     gl.blendFunc(gl.ONE_MINUS_SRC_ALPHA, gl.SRC_ALPHA);
//     gl.disable(gl.DEPTH_TEST);
//     gl.depthMask(true);
    
//     gl.useProgram(approxCompositeProgram);
    
//     const accumLoc = gl.getUniformLocation(approxCompositeProgram, 'u_accumTexture');
//     const revealLoc = gl.getUniformLocation(approxCompositeProgram, 'u_revealTexture');
    
//     gl.activeTexture(gl.TEXTURE0);
//     gl.bindTexture(gl.TEXTURE_2D, textureSet.accumTexture);
//     gl.uniform1i(accumLoc, 0);
    
//     gl.activeTexture(gl.TEXTURE1);
//     gl.bindTexture(gl.TEXTURE_2D, textureSet.revealTexture);
//     gl.uniform1i(revealLoc, 1);
    
//     gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
//     const posLoc = gl.getAttribLocation(approxCompositeProgram, 'a_position');
//     gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);
//     gl.enableVertexAttribArray(posLoc);
    
//     gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    
//     gl.enable(gl.DEPTH_TEST);
// }

// // ============================================================================
// // XR FUNCTIONS
// // ============================================================================

// function onXRFrame(time, frame) {
//     if (!xrSession) return;
    
//     xrSession.requestAnimationFrame(onXRFrame);

//     const pose = frame.getViewerPose(xrReferenceSpace);
//     if (!pose) return;

//     const glLayer = xrSession.renderState.baseLayer;
//     gl.bindFramebuffer(gl.FRAMEBUFFER, glLayer.framebuffer);
    
//     gl.clearColor(1.0, 1.0, 1.0, 1);
//     gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    
//     for (const view of pose.views) {
//         drawSceneWithApproxBlending(view);
//     }
// }

// async function enterVR() {
//     if (xrSession) {
//         xrSession.end();
//         return;
//     }

//     try {
//         updateStatus('Requesting VR session...');
        
//         const session = await navigator.xr.requestSession('immersive-vr');
//         xrSession = session;
        
//         updateStatus('VR session started');
//         vrButton.textContent = 'Exit VR';

//         session.addEventListener('end', () => {
//             updateStatus('VR session ended');
//             xrSession = null;
//             xrReferenceSpace = null;
//             vrButton.textContent = 'Enter VR';
//         });

//         await gl.makeXRCompatible();
        
//         const xrLayer = new XRWebGLLayer(session, gl);
//         await session.updateRenderState({ baseLayer: xrLayer });

//         xrReferenceSpace = await session.requestReferenceSpace('local');
//         updateStatus('Transparent cubes + test planes rendering with approximate alpha blending');
        
//         session.requestAnimationFrame(onXRFrame);

//     } catch (error) {
//         updateStatus(`VR Error: ${error.message}`);
//         console.error('VR session error:', error);
//         if (xrSession) {
//             xrSession.end();
//             xrSession = null;
//         }
//     }
// }

// // ============================================================================
// // STARTUP
// // ============================================================================

// window.addEventListener('load', async () => {
//     vrButton = document.getElementById('vr-button');
//     statusDiv = document.getElementById('status');

//     if (!vrButton || !statusDiv) {
//         updateStatus('Missing HTML elements');
//         return;
//     }

//     if (!initGL()) {
//         updateStatus('WebGL initialization failed');
//         return;
//     }

//     if (!navigator.xr) {
//         updateStatus('WebXR not supported');
//         return;
//     }

//     try {
//         const supported = await navigator.xr.isSessionSupported('immersive-vr');
//         if (supported) {
//             updateStatus('VR supported - click Enter VR');
//             vrButton.disabled = false;
//             vrButton.addEventListener('click', enterVR);
//         } else {
//             updateStatus('VR not supported on this device');
//         }
//     } catch (error) {
//         updateStatus(`Error checking VR support: ${error.message}`);
//     }
// });
import { cubeSize, indices, vertices } from "./cube.js";
import { APPROX_COMPOSITE_FS, APPROX_COMPOSITE_VS, APPROX_FS, APPROX_VS } from "./shaders.js";

const SIMPLE_FS = `
    precision highp float;
    
    uniform int u_useVertexColor;
    
    varying vec3 v_position;
    varying vec3 v_normal;
    varying vec3 v_color;
    
    void main() {
        // Simple lighting
        vec3 lightDir = normalize(vec3(0.5, 0.5, -1.0));
        vec3 normal = normalize(v_normal);
        float diff = max(dot(normal, lightDir), 0.0) * 0.6 + 0.4;
        
        // Color: use vertex color if available, otherwise position-based
        vec3 color;
        if (u_useVertexColor == 1) {
            color = v_color * diff;
        } else {
            color = abs(normalize(v_position)) * diff;
        }
        
        gl_FragColor = vec4(color, 0.3); // Semi-transparent
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

    simpleProgram = createProgram(gl, APPROX_VS, SIMPLE_FS);
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

    gl.clearColor(0.1, 0.1, 0.2, 1.0);
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

function renderCubes(projMatrix, viewMatrix, modelMatrix, program) {
    gl.useProgram(program);
    
    const projLoc = gl.getUniformLocation(program, 'u_projectionMatrix');
    const viewLoc = gl.getUniformLocation(program, 'u_viewMatrix');
    const modelLoc = gl.getUniformLocation(program, 'u_modelMatrix');
    const useVertexColorLoc = gl.getUniformLocation(program, 'u_useVertexColor');
    
    gl.uniformMatrix4fv(projLoc, false, projMatrix);
    gl.uniformMatrix4fv(viewLoc, false, viewMatrix);
    gl.uniformMatrix4fv(modelLoc, false, modelMatrix);
    
    if (useVertexColorLoc !== null) {
        gl.uniform1i(useVertexColorLoc, 1);
    }
    
    const posLoc = gl.getAttribLocation(program, 'a_position');
    const instPosLoc = gl.getAttribLocation(program, 'a_instancePosition');
    const colorLoc = gl.getAttribLocation(program, 'a_color');
    
    if (!renderCubes.logged) {
        console.log('Cube render attributes:', { posLoc, instPosLoc, colorLoc, useVertexColorLoc });
        renderCubes.logged = true;
    }
    
    gl.bindBuffer(gl.ARRAY_BUFFER, cubeBuffer);
    gl.vertexAttribPointer(posLoc, 3, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(posLoc);
    instancingExt.vertexAttribDivisorANGLE(posLoc, 0);
    
    gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuffer);
    gl.vertexAttribPointer(instPosLoc, 3, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(instPosLoc);
    instancingExt.vertexAttribDivisorANGLE(instPosLoc, 1);
    
    if (colorLoc >= 0) {
        gl.bindBuffer(gl.ARRAY_BUFFER, cubeColorBuffer);
        gl.vertexAttribPointer(colorLoc, 3, gl.FLOAT, false, 0, 0);
        gl.enableVertexAttribArray(colorLoc);
        instancingExt.vertexAttribDivisorANGLE(colorLoc, 1); 
    } else {
        console.warn('Color attribute location is invalid:', colorLoc);
    }
    
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    
    instancingExt.drawElementsInstancedANGLE(
        gl.TRIANGLES, 
        36, 
        gl.UNSIGNED_SHORT, 
        0, 
        instanceCount
    );
}

function renderTestPlanes(projMatrix, viewMatrix, program) {
    gl.useProgram(program);
    
    const projLoc = gl.getUniformLocation(program, 'u_projectionMatrix');
    const viewLoc = gl.getUniformLocation(program, 'u_viewMatrix');
    const modelLoc = gl.getUniformLocation(program, 'u_modelMatrix');
    const alphaLoc = gl.getUniformLocation(program, 'u_alpha');
    const useVertexColorLoc = gl.getUniformLocation(program, 'u_useVertexColor');
    
    gl.uniformMatrix4fv(projLoc, false, projMatrix);
    gl.uniformMatrix4fv(viewLoc, false, viewMatrix);
    
    if (useVertexColorLoc !== null) {
        gl.uniform1i(useVertexColorLoc, 1);
    }
    
    const posLoc = gl.getAttribLocation(program, 'a_position');
    const instPosLoc = gl.getAttribLocation(program, 'a_instancePosition');
    const colorLoc = gl.getAttribLocation(program, 'a_color');
    
    gl.bindBuffer(gl.ARRAY_BUFFER, planeVertexBuffer);
    gl.vertexAttribPointer(posLoc, 3, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(posLoc);
    

    if (instPosLoc >= 0) {
        gl.disableVertexAttribArray(instPosLoc);
        gl.vertexAttrib3f(instPosLoc, 0, 0, 0);
        instancingExt.vertexAttribDivisorANGLE(instPosLoc, 0);
    }
    
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, planeIndexBuffer);
    
    const time = Date.now() * 0.001;
    
    const planes = [
        { z: -1.5, alpha: 0.4, colorBufferIndex: 1, rotationOffset: Math.PI * 2 / 3, rotationSpeed: -1.2 }, 
        { z: -1.0, alpha: 0.4, colorBufferIndex: 2, rotationOffset: 0, rotationSpeed: 0.8 }, 
        { z: -2.0, alpha: 0.4, colorBufferIndex: 0, rotationOffset: Math.PI * 4 / 3, rotationSpeed: 0.5 }  ,
    ];
    
    for (const plane of planes) {
        const angle = (time * plane.rotationSpeed) + plane.rotationOffset;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        
        const modelMatrix = new Float32Array([
            cos, -sin, 0, 0,
            sin, cos, 0, 0,
            0, 0, 1, 0,
            0, 0, plane.z, 1
        ]);
        
        gl.uniformMatrix4fv(modelLoc, false, modelMatrix);
        
        gl.uniform1f(alphaLoc, plane.alpha);
        
        if (colorLoc >= 0) {
            gl.bindBuffer(gl.ARRAY_BUFFER, planeColorBuffers[plane.colorBufferIndex]);
            gl.vertexAttribPointer(colorLoc, 3, gl.FLOAT, false, 0, 0);
            gl.enableVertexAttribArray(colorLoc);
        }
        
        gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
    }
}

function drawHelix(numPoints, projMatrix, viewMatrix, program) {
    gl.useProgram(program);
    
    const projLoc = gl.getUniformLocation(program, 'u_projectionMatrix');
    const viewLoc = gl.getUniformLocation(program, 'u_viewMatrix');
    const modelLoc = gl.getUniformLocation(program, 'u_modelMatrix');
    const alphaLoc = gl.getUniformLocation(program, 'u_alpha');
    const useVertexColorLoc = gl.getUniformLocation(program, 'u_useVertexColor');
    
    gl.uniformMatrix4fv(projLoc, false, projMatrix);
    gl.uniformMatrix4fv(viewLoc, false, viewMatrix);
    
    // Identity model matrix
    const modelMatrix = new Float32Array([
        1, 0, 0, 0,
        0, 1, 0, 0,
        0, 0, 1, 0,
        0, 0, -2, 1  // Position helix at z = -2
    ]);
    gl.uniformMatrix4fv(modelLoc, false, modelMatrix);
    
    // Set alpha for helix
    if (alphaLoc !== null) {
        gl.uniform1f(alphaLoc, 0.6);
    }
    
    // Use vertex colors
    if (useVertexColorLoc !== null) {
        gl.uniform1i(useVertexColorLoc, 1);
    }
    
    // Generate helix geometry
    const radius = 0.3;
    const height = 2.0;
    const turns = 3;
    
    const helixVertices = new Float32Array(numPoints * 3);
    const helixColors = new Float32Array(numPoints * 3);
    
    for (let i = 0; i < numPoints; i++) {
        const t = i / (numPoints - 1);
        const angle = t * turns * Math.PI * 2;
        const y = (t - 0.5) * height;
        
        helixVertices[i * 3] = Math.cos(angle) * radius;
        helixVertices[i * 3 + 1] = y;
        helixVertices[i * 3 + 2] = Math.sin(angle) * radius;
        
        // Rainbow colors along the helix
        helixColors[i * 3] = Math.sin(t * Math.PI * 2) * 0.5 + 0.5;
        helixColors[i * 3 + 1] = Math.sin(t * Math.PI * 2 + Math.PI * 2 / 3) * 0.5 + 0.5;
        helixColors[i * 3 + 2] = Math.sin(t * Math.PI * 2 + Math.PI * 4 / 3) * 0.5 + 0.5;
    }
    
    // Create or update helix buffers
    if (!drawHelix.vertexBuffer) {
        drawHelix.vertexBuffer = gl.createBuffer();
        drawHelix.colorBuffer = gl.createBuffer();
    }
    
    gl.bindBuffer(gl.ARRAY_BUFFER, drawHelix.vertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, helixVertices, gl.DYNAMIC_DRAW);
    
    const posLoc = gl.getAttribLocation(program, 'a_position');
    gl.vertexAttribPointer(posLoc, 3, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(posLoc);
    
    // Set color buffer
    const colorLoc = gl.getAttribLocation(program, 'a_color');
    if (colorLoc >= 0) {
        gl.bindBuffer(gl.ARRAY_BUFFER, drawHelix.colorBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, helixColors, gl.DYNAMIC_DRAW);
        gl.vertexAttribPointer(colorLoc, 3, gl.FLOAT, false, 0, 0);
        gl.enableVertexAttribArray(colorLoc);
    }
    
    // Disable instance attributes if they exist
    const instPosLoc = gl.getAttribLocation(program, 'a_instancePosition');
    if (instPosLoc >= 0) {
        gl.disableVertexAttribArray(instPosLoc);
        gl.vertexAttrib3f(instPosLoc, 0, 0, 0);
        if (instancingExt) {
            instancingExt.vertexAttribDivisorANGLE(instPosLoc, 0);
        }
    }
    
    // Draw the helix as a line strip
    gl.drawArrays(gl.LINE_STRIP, 0, numPoints);
}

function drawDNAHelix(numPoints, projMatrix, viewMatrix, program) {
    if (!program) {
        console.error('drawDNAHelix: program is null or undefined');
        return;
    }
    
    gl.useProgram(program);
    
    const projLoc = gl.getUniformLocation(program, 'u_projectionMatrix');
    const viewLoc = gl.getUniformLocation(program, 'u_viewMatrix');
    const modelLoc = gl.getUniformLocation(program, 'u_modelMatrix');
    const alphaLoc = gl.getUniformLocation(program, 'u_alpha');
    const useVertexColorLoc = gl.getUniformLocation(program, 'u_useVertexColor');
    
    gl.uniformMatrix4fv(projLoc, false, projMatrix);
    gl.uniformMatrix4fv(viewLoc, false, viewMatrix);
    
    const modelMatrix = new Float32Array([
        1, 0, 0, 0,
        0, 1, 0, 0,
        0, 0, 1, 0,
        0, 0, -2, 1
    ]);
    gl.uniformMatrix4fv(modelLoc, false, modelMatrix);
    
    if (alphaLoc !== null) {
        gl.uniform1f(alphaLoc, 0.6);
    }
    
    if (useVertexColorLoc !== null) {
        gl.uniform1i(useVertexColorLoc, 1);
    }
    
    const radius = 0.15;  // Smaller radius for each strand
    const height = 2.0;
    const turns = 3;
    const numRungs = 20;  // Number of connecting bars
    
    // Calculate total vertices needed:
    // 2 strands * numPoints + numRungs * 2 (each rung is 2 points for a line segment)
    const totalVertices = numPoints * 2 + numRungs * 2;
    const helixVertices = new Float32Array(totalVertices * 3);
    const helixColors = new Float32Array(totalVertices * 3);
    
    let vertexIndex = 0;
    
    // First strand
    for (let i = 0; i < numPoints; i++) {
        const t = i / (numPoints - 1);
        const angle = t * turns * Math.PI * 2;
        const y = (t - 0.5) * height;
        
        helixVertices[vertexIndex * 3] = Math.cos(angle) * radius;
        helixVertices[vertexIndex * 3 + 1] = y;
        helixVertices[vertexIndex * 3 + 2] = Math.sin(angle) * radius;
        
        // Blue color for first strand
        helixColors[vertexIndex * 3] = 0.2;
        helixColors[vertexIndex * 3 + 1] = 0.5;
        helixColors[vertexIndex * 3 + 2] = 1.0;
        
        vertexIndex++;
    }
    
    // Second strand (180 degrees offset)
    for (let i = 0; i < numPoints; i++) {
        const t = i / (numPoints - 1);
        const angle = t * turns * Math.PI * 2 + Math.PI;  // +PI for 180 degree offset
        const y = (t - 0.5) * height;
        
        helixVertices[vertexIndex * 3] = Math.cos(angle) * radius;
        helixVertices[vertexIndex * 3 + 1] = y;
        helixVertices[vertexIndex * 3 + 2] = Math.sin(angle) * radius;
        
        // Red color for second strand
        helixColors[vertexIndex * 3] = 1.0;
        helixColors[vertexIndex * 3 + 1] = 0.2;
        helixColors[vertexIndex * 3 + 2] = 0.5;
        
        vertexIndex++;
    }
    
    // Rungs connecting the two strands
    for (let i = 0; i < numRungs; i++) {
        const t = i / (numRungs - 1);
        const angle = t * turns * Math.PI * 2;
        const y = (t - 0.5) * height;
        
        // First point of rung (on first strand)
        helixVertices[vertexIndex * 3] = Math.cos(angle) * radius;
        helixVertices[vertexIndex * 3 + 1] = y;
        helixVertices[vertexIndex * 3 + 2] = Math.sin(angle) * radius;
        
        // White/gray color for rungs
        helixColors[vertexIndex * 3] = 0.8;
        helixColors[vertexIndex * 3 + 1] = 0.8;
        helixColors[vertexIndex * 3 + 2] = 0.8;
        
        vertexIndex++;
        
        // Second point of rung (on second strand, 180 degrees offset)
        helixVertices[vertexIndex * 3] = Math.cos(angle + Math.PI) * radius;
        helixVertices[vertexIndex * 3 + 1] = y;
        helixVertices[vertexIndex * 3 + 2] = Math.sin(angle + Math.PI) * radius;
        
        helixColors[vertexIndex * 3] = 0.8;
        helixColors[vertexIndex * 3 + 1] = 0.8;
        helixColors[vertexIndex * 3 + 2] = 0.8;
        
        vertexIndex++;
    }
    
    if (!drawDNAHelix.vertexBuffer) {
        drawDNAHelix.vertexBuffer = gl.createBuffer();
        drawDNAHelix.colorBuffer = gl.createBuffer();
    }
    
    gl.bindBuffer(gl.ARRAY_BUFFER, drawDNAHelix.vertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, helixVertices, gl.DYNAMIC_DRAW);
    
    const posLoc = gl.getAttribLocation(program, 'a_position');
    gl.vertexAttribPointer(posLoc, 3, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(posLoc);
    
    const colorLoc = gl.getAttribLocation(program, 'a_color');
    if (colorLoc >= 0) {
        gl.bindBuffer(gl.ARRAY_BUFFER, drawDNAHelix.colorBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, helixColors, gl.DYNAMIC_DRAW);
        gl.vertexAttribPointer(colorLoc, 3, gl.FLOAT, false, 0, 0);
        gl.enableVertexAttribArray(colorLoc);
    }
    
    const instPosLoc = gl.getAttribLocation(program, 'a_instancePosition');
    if (instPosLoc >= 0) {
        gl.disableVertexAttribArray(instPosLoc);
        gl.vertexAttrib3f(instPosLoc, 0, 0, 0);
        if (instancingExt) {
            instancingExt.vertexAttribDivisorANGLE(instPosLoc, 0);
        }
    }
    
    // Draw first strand
    gl.drawArrays(gl.LINE_STRIP, 0, numPoints);
    
    // Draw second strand
    gl.drawArrays(gl.LINE_STRIP, numPoints, numPoints);
    
    // Draw rungs as individual line segments
    gl.drawArrays(gl.LINES, numPoints * 2, numRungs * 2);
}

function drawHelixCubes(numCubes, projMatrix, viewMatrix, program) {
    gl.useProgram(program);
    
    const projLoc = gl.getUniformLocation(program, 'u_projectionMatrix');
    const viewLoc = gl.getUniformLocation(program, 'u_viewMatrix');
    const modelLoc = gl.getUniformLocation(program, 'u_modelMatrix');
    const alphaLoc = gl.getUniformLocation(program, 'u_alpha');
    const useVertexColorLoc = gl.getUniformLocation(program, 'u_useVertexColor');
    
    gl.uniformMatrix4fv(projLoc, false, projMatrix);
    gl.uniformMatrix4fv(viewLoc, false, viewMatrix);
    
    // Identity model matrix
    const modelMatrix = new Float32Array([
        1, 0, 0, 0,
        0, 1, 0, 0,
        0, 0, 1, 0,
        0, 0, -2, 1  // Position helix at z = -2
    ]);
    gl.uniformMatrix4fv(modelLoc, false, modelMatrix);
    
    // Set alpha for helix cubes
    if (alphaLoc !== null) {
        gl.uniform1f(alphaLoc, 0.6);
    }
    
    // Use vertex colors
    if (useVertexColorLoc !== null) {
        gl.uniform1i(useVertexColorLoc, 1);
    }
    
    // Generate helix positions and colors for cubes
    const radius = 0.3;
    const height = 2.0;
    const turns = 3;
    
    const helixPositions = new Float32Array(numCubes * 3);
    const helixColors = new Float32Array(numCubes * 3);
    
    for (let i = 0; i < numCubes; i++) {
        const t = i / (numCubes - 1);
        const angle = t * turns * Math.PI * 2;
        const y = (t - 0.5) * height;
        
        helixPositions[i * 3] = Math.cos(angle) * radius;
        helixPositions[i * 3 + 1] = y;
        helixPositions[i * 3 + 2] = Math.sin(angle) * radius;
        
        // Rainbow colors along the helix
        helixColors[i * 3] = Math.sin(t * Math.PI * 2) * 0.5 + 0.5;
        helixColors[i * 3 + 1] = Math.sin(t * Math.PI * 2 + Math.PI * 2 / 3) * 0.5 + 0.5;
        helixColors[i * 3 + 2] = Math.sin(t * Math.PI * 2 + Math.PI * 4 / 3) * 0.5 + 0.5;
    }
    
    // Create or update helix instance buffers
    if (!drawHelixCubes.positionBuffer) {
        drawHelixCubes.positionBuffer = gl.createBuffer();
        drawHelixCubes.colorBuffer = gl.createBuffer();
    }
    
    gl.bindBuffer(gl.ARRAY_BUFFER, drawHelixCubes.positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, helixPositions, gl.DYNAMIC_DRAW);
    
    gl.bindBuffer(gl.ARRAY_BUFFER, drawHelixCubes.colorBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, helixColors, gl.DYNAMIC_DRAW);
    
    // Set up cube vertex attributes
    const posLoc = gl.getAttribLocation(program, 'a_position');
    const instPosLoc = gl.getAttribLocation(program, 'a_instancePosition');
    const colorLoc = gl.getAttribLocation(program, 'a_color');
    
    // Bind cube geometry
    gl.bindBuffer(gl.ARRAY_BUFFER, cubeBuffer);
    gl.vertexAttribPointer(posLoc, 3, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(posLoc);
    instancingExt.vertexAttribDivisorANGLE(posLoc, 0);  // Per vertex
    
    // Bind helix instance positions
    gl.bindBuffer(gl.ARRAY_BUFFER, drawHelixCubes.positionBuffer);
    gl.vertexAttribPointer(instPosLoc, 3, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(instPosLoc);
    instancingExt.vertexAttribDivisorANGLE(instPosLoc, 1);  // Per instance
    
    // Bind helix instance colors
    if (colorLoc >= 0) {
        gl.bindBuffer(gl.ARRAY_BUFFER, drawHelixCubes.colorBuffer);
        gl.vertexAttribPointer(colorLoc, 3, gl.FLOAT, false, 0, 0);
        gl.enableVertexAttribArray(colorLoc);
        instancingExt.vertexAttribDivisorANGLE(colorLoc, 1);  // Per instance
    }
    
    // Bind cube indices
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    
    // Draw instanced cubes
    instancingExt.drawElementsInstancedANGLE(
        gl.TRIANGLES, 
        36,  // 36 indices per cube
        gl.UNSIGNED_SHORT, 
        0, 
        numCubes
    );
}

// function drawSceneWithApproxBlending(view) {
//     const viewport = xrSession.renderState.baseLayer.getViewport(view);
//     const width = Math.floor(viewport.width);
//     const height = Math.floor(viewport.height);
//     const x = Math.floor(viewport.x);
//     const y = Math.floor(viewport.y);
    
//     if (width <= 0 || height <= 0) return;
    
//     // const isLeftEye = viewport.x === 0;
//     const isLeftEye = view.eye === 'left';
//     const textureSet = isLeftEye ? leftEyeApproxTextures : rightEyeApproxTextures;
    
//     const modelMatrix = new Float32Array([
//         1, 0, 0, 0,
//         0, 1, 0, 0,
//         0, 0, 1, 0,
//         0, 0, 0, 1
//     ]);
    
//     if (!drawBuffersExt || !approxProgram || !approxCompositeProgram) {
//         gl.bindFramebuffer(gl.FRAMEBUFFER, xrSession.renderState.baseLayer.framebuffer);
//         gl.viewport(x, y, width, height);
//         gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
//         renderCubes(view.projectionMatrix, view.transform.inverse.matrix, modelMatrix, simpleProgram);

//         renderTestPlanes(view.projectionMatrix, view.transform.inverse.matrix, simpleProgram);
//         console.log('rendering in fallback mode')
//         return;
//     }
    
//     const needsRecreation = !textureSet.accumTexture || 
//                            textureSet.accumTexture.width !== width ||
//                            textureSet.accumTexture.height !== height;
    
//     if (needsRecreation) {
//         console.log(`Creating approx ${isLeftEye ? 'LEFT' : 'RIGHT'} eye textures: ${width}x${height}`);
//         setupApproxTextures(textureSet, width, height);
//     }
    
//     gl.bindFramebuffer(gl.FRAMEBUFFER, textureSet.framebuffer);
//     gl.viewport(0, 0, width, height);
    
//     drawBuffersExt.drawBuffersWEBGL([
//         drawBuffersExt.COLOR_ATTACHMENT0_WEBGL,
//         drawBuffersExt.COLOR_ATTACHMENT1_WEBGL
//     ]);
    
//     gl.clearColor(0.0, 0.0, 0.0, 0.0);
//     gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    
//     gl.enable(gl.BLEND);
//     gl.blendEquation(gl.FUNC_ADD);
//     gl.blendFunc(gl.ONE, gl.ONE); 
//     gl.blendFuncSeparate(gl.ONE, gl.ONE,  
//                      gl.ZERO, gl.ONE_MINUS_SRC_ALPHA); 
    
//     gl.depthMask(false); 
//     gl.enable(gl.DEPTH_TEST); 
//     gl.depthFunc(gl.LESS);
    
//     gl.useProgram(approxProgram);
//     const alphaLoc = gl.getUniformLocation(approxProgram, 'u_alpha');
    
//     if (!drawSceneWithApproxBlending.loggedAlpha) {
//         console.log('ALPHA constant:', ALPHA);
//         console.log('Alpha uniform location:', alphaLoc);
//         drawSceneWithApproxBlending.loggedAlpha = true;
//     }
    
//     gl.uniform1f(alphaLoc, ALPHA);
    
//     // renderCubes(view.projectionMatrix, view.transform.inverse.matrix, 
//     //             modelMatrix, approxProgram);
    
//     // renderTestPlanes(view.projectionMatrix, view.transform.inverse.matrix, approxProgram);
//     // drawHelix(50, view.projectionMatrix, view.transform.inverse.matrix, approxProgram);
//     drawDNAHelix(2000, view.projectionMatrix, view.transform.inverse.matrix, approxProgram);
//     // drawHelixCubes(20, view.projectionMatrix, view.transform.inverse.matrix, approxProgram);
    
//     gl.bindFramebuffer(gl.FRAMEBUFFER, xrSession.renderState.baseLayer.framebuffer);
//     gl.enable(gl.SCISSOR_TEST);
//     gl.scissor(x, y, width, height);
//     gl.viewport(x, y, width, height);
//     gl.viewport(x, y, width, height);
    
//     gl.clearColor(0.7, 0.7, 0.85, 1.0);
//     gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    
//     gl.enable(gl.BLEND);
//     gl.blendFunc(gl.ONE_MINUS_SRC_ALPHA, gl.SRC_ALPHA);
//     // gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
//     gl.disable(gl.DEPTH_TEST);
//     gl.depthMask(true);
    
//     gl.useProgram(approxCompositeProgram);
    
//     const accumLoc = gl.getUniformLocation(approxCompositeProgram, 'u_accumTexture');
//     const revealLoc = gl.getUniformLocation(approxCompositeProgram, 'u_revealTexture');
    
//     gl.activeTexture(gl.TEXTURE0);
//     gl.bindTexture(gl.TEXTURE_2D, textureSet.accumTexture);
//     gl.uniform1i(accumLoc, 0);
    
//     gl.activeTexture(gl.TEXTURE1);
//     gl.bindTexture(gl.TEXTURE_2D, textureSet.revealTexture);
//     gl.uniform1i(revealLoc, 1);
    
//     gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
//     const posLoc = gl.getAttribLocation(approxCompositeProgram, 'a_position');
//     gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);
//     gl.enableVertexAttribArray(posLoc);
    
//     gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    
//     gl.enable(gl.DEPTH_TEST);
// }

// ============================================================================
// XR FUNCTIONS
// ============================================================================

function drawSceneWithApproxBlending(view) {
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
    
    if (!drawBuffersExt || !approxProgram || !approxCompositeProgram) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, xrSession.renderState.baseLayer.framebuffer);
        gl.viewport(x, y, width, height);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        renderCubes(view.projectionMatrix, view.transform.inverse.matrix, modelMatrix, simpleProgram);
        renderTestPlanes(view.projectionMatrix, view.transform.inverse.matrix, simpleProgram);
        console.log('rendering in fallback mode')
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
    gl.blendFuncSeparate(gl.ONE, gl.ONE, gl.ZERO, gl.ONE_MINUS_SRC_ALPHA); 
    
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
    
    drawDNAHelix(2000, view.projectionMatrix, view.transform.inverse.matrix, approxProgram);
    // drawHelix(2000, view.projectionMatrix, view.transform.inverse.matrix, approxProgram);
    renderTestPlanes(view.projectionMatrix, view.transform.inverse.matrix, approxProgram);
    
    // === COMPOSITE PASS ===
    gl.bindFramebuffer(gl.FRAMEBUFFER, xrSession.renderState.baseLayer.framebuffer);
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(x, y, width, height);
    gl.viewport(x, y, width, height);
    
    gl.clearColor(0.7, 0.7, 0.85, 1.0);
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
    
    gl.clearColor(1.0, 1.0, 1.0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    
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