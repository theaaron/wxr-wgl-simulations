import { cubeSize, indices, vertices } from "./cube.js";
import { APPROX_COMPOSITE_FS, APPROX_COMPOSITE_VS, APPROX_FS, APPROX_VS } from "./shaders.js";

const SIMPLE_VS = `
    attribute vec3 a_position;
    attribute vec3 a_instancePosition;
    attribute vec3 a_color;
    
    uniform mat4 u_projectionMatrix;
    uniform mat4 u_viewMatrix;
    uniform mat4 u_modelMatrix;
    uniform float u_cubeScale;
    
    varying vec3 v_position;
    varying vec3 v_normal;
    varying vec3 v_color;
    
    void main() {
        // Scale the cube vertex, then add the instance position
        vec3 scaledCubeVertex = a_position * u_cubeScale;
        vec3 pos = scaledCubeVertex + a_instancePosition;
        vec4 worldPos = u_modelMatrix * vec4(pos, 1.0);
        gl_Position = u_projectionMatrix * u_viewMatrix * worldPos;
        
        v_position = worldPos.xyz;
        v_normal = a_position;
        v_color = a_color;
    }
`;

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

async function loadStructure(path) {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`Failed to load atria data: ${response.status}`);
  }
  const data = await response.json();

  const voxels = [];
  const indices = data.fullTexelIndex;
  const nx = data.nx;
  const ny = data.ny;
  const mx = data.mx;
  const my = data.my;
  
  
  const fullWidth = data.full_width;
  const fullHeight = data.full_height;
  
  let minZ = Infinity, maxZ = -Infinity;
  const zSlicesUsed = new Set();
  
  for (let i = 0; i < indices.length; i += 4) {
    const texX = indices[i];     
    const texY = indices[i + 1]; 
    const slice = indices[i + 2]; 
    const value = indices[i + 3]; 
    
    // normailzing the texture coords
    const pixPosX = texX / fullWidth;
    const pixPosY = texY / fullHeight;
    
    const blockX = Math.floor(pixPosX * mx);
    const blockY = Math.floor(pixPosY * my);
    
    const z = blockX + ((my - 1) - blockY) * mx;
    
    const x = texX % nx;
    const y = texY % ny;
    
    minZ = Math.min(minZ, z);
    maxZ = Math.max(maxZ, z);
    zSlicesUsed.add(z);
    
    voxels.push({ x, y, z, value });
  }
  
  console.log(`Grid dimensions: nx=${nx}, ny=${ny}, nz=${mx * my}`);
  console.log(`Texture atlas: ${mx}×${my} blocks of ${nx}×${ny} each`);
  console.log(`Z slices actually used: ${zSlicesUsed.size} slices from ${minZ} to ${maxZ}`);
  console.log(`Using abubu.js fullCoordinator algorithm (Y-inverted block ordering)`);
  
  return {
    dimensions: { nx: data.nx, ny: data.ny, nz: mx * my },
    metadata: {
      mx: data.mx,
      my: data.my,
      threshold: data.threshold,
      fullWidth: data.full_width,
      fullHeight: data.full_height,
      compWidth: data.comp_width,
      compHeight: data.comp_height
    },
    voxels,
    raw: data
  };
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

const ALPHA = 1.0; 
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

async function renderStructure(path, projMatrix, viewMatrix, modelMatrix, program) {
    // Load structure data if not already cached
    if (!renderStructure.cachedStructure) {
        path = './resources/atria_64x64x64.json';
        try {
            renderStructure.cachedStructure = await loadStructure(path);
            const struct = renderStructure.cachedStructure;
            console.log(`Loaded ${struct.voxels.length} voxels`);
            console.log(`Grid dimensions: ${struct.dimensions.nx}×${struct.dimensions.ny}×${struct.dimensions.nz}`);
            console.log(`Sample voxels:`, struct.voxels.slice(0, 5));
            console.log(`First voxel coords: x=${struct.voxels[0].x}, y=${struct.voxels[0].y}, z=${struct.voxels[0].z}`);
            console.log(`Second voxel coords: x=${struct.voxels[1].x}, y=${struct.voxels[1].y}, z=${struct.voxels[1].z}`);
            console.log(`Rendering ${struct.voxels.length} cube instances`);
        } catch (error) {
            console.error('Failed to load structure:', error);
            return;
        }
    }
    
    const structure = renderStructure.cachedStructure;
    const numCubes = structure.voxels.length;
    
    if (numCubes === 0) {
        console.warn('No voxels to render');
        return;
    }
    
    // Debug: count render calls
    if (!renderStructure.frameCounter) {
        renderStructure.frameCounter = 0;
        renderStructure.callsThisFrame = 0;
    }
    renderStructure.callsThisFrame++;
    if (Date.now() - (renderStructure.lastLog || 0) > 1000) {
        console.log(`Render calls per frame: ${renderStructure.callsThisFrame}. Rendering ${numCubes}/${structure.voxels.length} voxels`);
        renderStructure.lastLog = Date.now();
        renderStructure.callsThisFrame = 0;
    }

    gl.useProgram(program);

    const projLoc = gl.getUniformLocation(program, 'u_projectionMatrix');
    const viewLoc = gl.getUniformLocation(program, 'u_viewMatrix');
    const modelLoc = gl.getUniformLocation(program, 'u_modelMatrix');
    const alphaLoc = gl.getUniformLocation(program, 'u_alpha');
    const useVertexColorLoc = gl.getUniformLocation(program, 'u_useVertexColor');
    
    gl.uniformMatrix4fv(projLoc, false, projMatrix);
    gl.uniformMatrix4fv(viewLoc, false, viewMatrix);
    

    const globalScale = 0.02; 
    const zScale = renderStructure.zScale || 1.0;
    modelMatrix = new Float32Array([
        globalScale, 0, 0, 0,      
        0, globalScale, 0, 0,      
        0, 0, globalScale * zScale, 0, // z scale not needed anymore but i'll leave it here for now
        0, 0, -1, 1     
    ]);
    gl.uniformMatrix4fv(modelLoc, false, modelMatrix);
    

    const voxelSize = renderStructure.voxelScale || 3.0;
    const cubeScaleLoc = gl.getUniformLocation(program, 'u_cubeScale');
    if (cubeScaleLoc !== null) {
        gl.uniform1f(cubeScaleLoc, voxelSize);
    }
    
    if (alphaLoc !== null) {
        gl.uniform1f(alphaLoc, ALPHA); 
    }
    
    if (useVertexColorLoc !== null) {
        gl.uniform1i(useVertexColorLoc, 1);
    }
    
    const structurePositions = new Float32Array(numCubes * 3);
    const structureColors = new Float32Array(numCubes * 3);
    
    const centerX = structure.dimensions.nx / 2;
    const centerY = structure.dimensions.ny / 2;
    const centerZ = structure.dimensions.nz / 2;
    
    for (let i = 0; i < numCubes; i++) {
        const voxel = structure.voxels[i];
        
        structurePositions[i * 3] = voxel.x - centerX;
        structurePositions[i * 3 + 1] = voxel.y - centerY;
        structurePositions[i * 3 + 2] = voxel.z - centerZ;
        
        // Color: normalize voxel value to 0-1 range and create color gradient
        const normalizedValue = voxel.value / 255.0;
        structureColors[i * 3] = normalizedValue; // Red based on value
        structureColors[i * 3 + 1] = 0.5 + normalizedValue * 0.5; // Green
        structureColors[i * 3 + 2] = 1.0 - normalizedValue * 0.5; // Blue
    }
    
    // this is just to log the first few pos/cols for debugging
    if (!renderStructure.loggedPositions) {
        console.log('First 5 voxel positions:', structurePositions.slice(0, 15));
        console.log('Center offsets:', { centerX, centerY, centerZ });
        console.log('Buffer size:', structurePositions.length, 'floats for', numCubes, 'cubes');
        renderStructure.loggedPositions = true;
    }
    
    if (!renderStructure.positionBuffer) {
        renderStructure.positionBuffer = gl.createBuffer();
        renderStructure.colorBuffer = gl.createBuffer();
    }
    
    gl.bindBuffer(gl.ARRAY_BUFFER, renderStructure.positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, structurePositions, gl.DYNAMIC_DRAW);
    
    gl.bindBuffer(gl.ARRAY_BUFFER, renderStructure.colorBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, structureColors, gl.DYNAMIC_DRAW);
    
    const posLoc = gl.getAttribLocation(program, 'a_position');
    const instPosLoc = gl.getAttribLocation(program, 'a_instancePosition');
    const colorLoc = gl.getAttribLocation(program, 'a_color');
    
    gl.bindBuffer(gl.ARRAY_BUFFER, cubeBuffer);
    gl.vertexAttribPointer(posLoc, 3, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(posLoc);
    instancingExt.vertexAttribDivisorANGLE(posLoc, 0);  
    
    gl.bindBuffer(gl.ARRAY_BUFFER, renderStructure.positionBuffer);
    gl.vertexAttribPointer(instPosLoc, 3, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(instPosLoc);
    instancingExt.vertexAttribDivisorANGLE(instPosLoc, 1); 
    
    if (colorLoc >= 0) {
        gl.bindBuffer(gl.ARRAY_BUFFER, renderStructure.colorBuffer);
        gl.vertexAttribPointer(colorLoc, 3, gl.FLOAT, false, 0, 0);
        gl.enableVertexAttribArray(colorLoc);
        instancingExt.vertexAttribDivisorANGLE(colorLoc, 1);  
    }
    
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    
    instancingExt.drawElementsInstancedANGLE(
        gl.TRIANGLES, 
        36,  
        gl.UNSIGNED_SHORT, 
        0, 
        numCubes
    );

}

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
    
    const modelMatrix = new Float32Array([
        1, 0, 0, 0,
        0, 1, 0, 0,
        0, 0, 1, 0,
        0, 0, -2, 1  // Position helix at z = -2
    ]);
    gl.uniformMatrix4fv(modelLoc, false, modelMatrix);
    
    if (alphaLoc !== null) {
        gl.uniform1f(alphaLoc, 0.6);
    }
    
    if (useVertexColorLoc !== null) {
        gl.uniform1i(useVertexColorLoc, 1);
    }
    
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
        
        helixColors[i * 3] = Math.sin(t * Math.PI * 2) * 0.5 + 0.5;
        helixColors[i * 3 + 1] = Math.sin(t * Math.PI * 2 + Math.PI * 2 / 3) * 0.5 + 0.5;
        helixColors[i * 3 + 2] = Math.sin(t * Math.PI * 2 + Math.PI * 4 / 3) * 0.5 + 0.5;
    }
    
    if (!drawHelix.vertexBuffer) {
        drawHelix.vertexBuffer = gl.createBuffer();
        drawHelix.colorBuffer = gl.createBuffer();
    }
    
    gl.bindBuffer(gl.ARRAY_BUFFER, drawHelix.vertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, helixVertices, gl.DYNAMIC_DRAW);
    
    const posLoc = gl.getAttribLocation(program, 'a_position');
    gl.vertexAttribPointer(posLoc, 3, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(posLoc);
    
    const colorLoc = gl.getAttribLocation(program, 'a_color');
    if (colorLoc >= 0) {
        gl.bindBuffer(gl.ARRAY_BUFFER, drawHelix.colorBuffer);
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
    
    const radius = 0.15; 
    const height = 2.0;
    const turns = 3;
    const numRungs = 20;  
    
    const totalVertices = numPoints * 2 + numRungs * 2;
    const helixVertices = new Float32Array(totalVertices * 3);
    const helixColors = new Float32Array(totalVertices * 3);
    
    let vertexIndex = 0;
    
    for (let i = 0; i < numPoints; i++) {
        const t = i / (numPoints - 1);
        const angle = t * turns * Math.PI * 2;
        const y = (t - 0.5) * height;
        
        helixVertices[vertexIndex * 3] = Math.cos(angle) * radius;
        helixVertices[vertexIndex * 3 + 1] = y;
        helixVertices[vertexIndex * 3 + 2] = Math.sin(angle) * radius;
        
        helixColors[vertexIndex * 3] = 0.2;
        helixColors[vertexIndex * 3 + 1] = 0.5;
        helixColors[vertexIndex * 3 + 2] = 1.0;
        
        vertexIndex++;
    }
    
    for (let i = 0; i < numPoints; i++) {
        const t = i / (numPoints - 1);
        const angle = t * turns * Math.PI * 2 + Math.PI;  
        const y = (t - 0.5) * height;
        
        helixVertices[vertexIndex * 3] = Math.cos(angle) * radius;
        helixVertices[vertexIndex * 3 + 1] = y;
        helixVertices[vertexIndex * 3 + 2] = Math.sin(angle) * radius;
        
        helixColors[vertexIndex * 3] = 1.0;
        helixColors[vertexIndex * 3 + 1] = 0.2;
        helixColors[vertexIndex * 3 + 2] = 0.5;
        
        vertexIndex++;
    }
    
    for (let i = 0; i < numRungs; i++) {
        const t = i / (numRungs - 1);
        const angle = t * turns * Math.PI * 2;
        const y = (t - 0.5) * height;
        
        helixVertices[vertexIndex * 3] = Math.cos(angle) * radius;
        helixVertices[vertexIndex * 3 + 1] = y;
        helixVertices[vertexIndex * 3 + 2] = Math.sin(angle) * radius;
        
        helixColors[vertexIndex * 3] = 0.8;
        helixColors[vertexIndex * 3 + 1] = 0.8;
        helixColors[vertexIndex * 3 + 2] = 0.8;
        
        vertexIndex++;
        
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
    
    gl.drawArrays(gl.LINE_STRIP, 0, numPoints);
    
    gl.drawArrays(gl.LINE_STRIP, numPoints, numPoints);
    
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
    

    const scale = 0.5; 
    const modelMatrix = new Float32Array([
        scale, 0, 0, 0,      
        0, scale, 0, 0,      
        0, 0, scale, 0,      
        0, 0, -2, 1          
    ]);
    gl.uniformMatrix4fv(modelLoc, false, modelMatrix);
    
    if (alphaLoc !== null) {
        gl.uniform1f(alphaLoc, ALPHA); // Fully opaque
    }
    
    if (useVertexColorLoc !== null) {
        gl.uniform1i(useVertexColorLoc, 1);
    }
    
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
        
        helixColors[i * 3] = Math.sin(t * Math.PI * 2) * 0.5 + 0.5;
        helixColors[i * 3 + 1] = Math.sin(t * Math.PI * 2 + Math.PI * 2 / 3) * 0.5 + 0.5;
        helixColors[i * 3 + 2] = Math.sin(t * Math.PI * 2 + Math.PI * 4 / 3) * 0.5 + 0.5;
    }
    
    if (!drawHelixCubes.positionBuffer) {
        drawHelixCubes.positionBuffer = gl.createBuffer();
        drawHelixCubes.colorBuffer = gl.createBuffer();
    }
    
    gl.bindBuffer(gl.ARRAY_BUFFER, drawHelixCubes.positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, helixPositions, gl.DYNAMIC_DRAW);
    
    gl.bindBuffer(gl.ARRAY_BUFFER, drawHelixCubes.colorBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, helixColors, gl.DYNAMIC_DRAW);
    
    const posLoc = gl.getAttribLocation(program, 'a_position');
    const instPosLoc = gl.getAttribLocation(program, 'a_instancePosition');
    const colorLoc = gl.getAttribLocation(program, 'a_color');
    
    gl.bindBuffer(gl.ARRAY_BUFFER, cubeBuffer);
    gl.vertexAttribPointer(posLoc, 3, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(posLoc);
    instancingExt.vertexAttribDivisorANGLE(posLoc, 0);  
    
    gl.bindBuffer(gl.ARRAY_BUFFER, drawHelixCubes.positionBuffer);
    gl.vertexAttribPointer(instPosLoc, 3, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(instPosLoc);
    instancingExt.vertexAttribDivisorANGLE(instPosLoc, 1); 
    
    if (colorLoc >= 0) {
        gl.bindBuffer(gl.ARRAY_BUFFER, drawHelixCubes.colorBuffer);
        gl.vertexAttribPointer(colorLoc, 3, gl.FLOAT, false, 0, 0);
        gl.enableVertexAttribArray(colorLoc);
        instancingExt.vertexAttribDivisorANGLE(colorLoc, 1);  
    }
    
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    
    instancingExt.drawElementsInstancedANGLE(
        gl.TRIANGLES, 
        36,  
        gl.UNSIGNED_SHORT, 
        0, 
        numCubes
    );
}

// ============================================================================
// XR FUNCTIONS
// ============================================================================

async function drawSceneWithApproxBlending(view) {
    const goOpaque = true; 
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

    const path = 'resources/atria_64x64x64.json';
    const program = simpleProgram || approxProgram;
    await renderStructure(path, view.projectionMatrix, view.transform.inverse.matrix, modelMatrix, program);
    
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

    await renderStructure(path, view.projectionMatrix, view.transform.inverse.matrix, modelMatrix, approxProgram);
    drawDNAHelix(2000, view.projectionMatrix, view.transform.inverse.matrix, approxProgram);
    // drawHelixCubes(100, view.projectionMatrix, view.transform.inverse.matrix, approxProgram);
    // drawHelix(2000, view.projectionMatrix, view.transform.inverse.matrix, approxProgram);
    // renderTestPlanes(view.projectionMatrix, view.transform.inverse.matrix, approxProgram);
    // renderCubes(view.projectionMatrix, view.transform.inverse.matrix, approxProgram);

    
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

async function onXRFrame(time, frame) {
    if (!xrSession) return;
    
    xrSession.requestAnimationFrame(onXRFrame);

    const pose = frame.getViewerPose(xrReferenceSpace);
    if (!pose) return;

    const glLayer = xrSession.renderState.baseLayer;
    gl.bindFramebuffer(gl.FRAMEBUFFER, glLayer.framebuffer);
    
    
    for (const view of pose.views) {
        await drawSceneWithApproxBlending(view);
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