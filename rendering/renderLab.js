import { loadGLB } from './loadGLB.js';
import { OBJ_VS, OBJ_FS } from '../shaders.js';

let labModel = null;
let labProgram = null;
let labBuffers = {};
let labTextures = {};
let labLoaded = false;
let labLoading = null;


function createBuffers(gl, geometry) {
  const positionBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(geometry.positions), gl.STATIC_DRAW);

  const normalBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, normalBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(geometry.normals), gl.STATIC_DRAW);

  const texCoordBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(geometry.texCoords), gl.STATIC_DRAW);

  const indexBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(geometry.indices), gl.STATIC_DRAW);

  return { positionBuffer, normalBuffer, texCoordBuffer, indexBuffer, indexCount: geometry.indices.length };
}



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
  const vs = compileShader(gl, vsSource, gl.VERTEX_SHADER);
  const fs = compileShader(gl, fsSource, gl.FRAGMENT_SHADER);
  if (!vs || !fs) return null;

  const program = gl.createProgram();
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error('Program link error:', gl.getProgramInfoLog(program));
    gl.deleteProgram(program);
    return null;
  }
  return program;
}

// inverse-transpose of the upper-left 3x3 of the model-view matrix
function computeNormalMatrix(modelMatrix, viewMatrix) {
  const mv = new Float32Array(16);
  for (let i = 0; i < 4; i++)
    for (let j = 0; j < 4; j++) {
      mv[i * 4 + j] = 0;
      for (let k = 0; k < 4; k++) mv[i * 4 + j] += viewMatrix[i * 4 + k] * modelMatrix[k * 4 + j];
    }

  const n = new Float32Array(9);
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) n[i * 3 + j] = mv[i * 4 + j];

  const det = n[0] * (n[4] * n[8] - n[5] * n[7]) - n[1] * (n[3] * n[8] - n[5] * n[6]) + n[2] * (n[3] * n[7] - n[4] * n[6]);
  if (Math.abs(det) < 0.0001) return new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);

  const d = 1 / det;
  return new Float32Array([
    (n[4] * n[8] - n[5] * n[7]) * d, -(n[1] * n[8] - n[2] * n[7]) * d, (n[1] * n[5] - n[2] * n[4]) * d,
    -(n[3] * n[8] - n[5] * n[6]) * d, (n[0] * n[8] - n[2] * n[6]) * d, -(n[0] * n[5] - n[2] * n[3]) * d,
    (n[3] * n[7] - n[4] * n[6]) * d, -(n[0] * n[7] - n[1] * n[6]) * d, (n[0] * n[4] - n[1] * n[3]) * d
  ]);
}

export async function loadLabModel(gl, glbPath) {
  if (labLoading) return labLoading;
  if (labLoaded) return labModel;

  labLoading = (async () => {
    try {
      console.log('Loading lab model...');
      const model = await loadGLB(glbPath, gl);

      labProgram = createProgram(gl, OBJ_VS, OBJ_FS);
      if (!labProgram) throw new Error('Failed to create lab shader program');

      labBuffers = {};
      labTextures = {};

      for (const [name, geometry] of Object.entries(model.geometry)) {
        labBuffers[name] = createBuffers(gl, geometry);
        labTextures[name] = geometry.glTexture ?? null;
      }

      labModel = model;
      labLoaded = true;
      labLoading = null;
      const texCount = Object.values(labTextures).filter(Boolean).length;
      const total = Object.keys(labTextures).length;
      console.log(`Lab model loaded — ${texCount}/${total} materials have textures`);
      return model;
    } catch (error) {
      console.error('Failed to load lab model:', error);
      labLoading = null;
      throw error;
    }
  })();

  return labLoading;
}

export function renderLab(gl, projMatrix, viewMatrix, modelMatrix) {
  if (!labLoaded || !labModel || !labProgram) return;

  gl.disable(gl.CULL_FACE);
  gl.useProgram(labProgram);

  gl.uniformMatrix4fv(gl.getUniformLocation(labProgram, 'u_projectionMatrix'), false, projMatrix);
  gl.uniformMatrix4fv(gl.getUniformLocation(labProgram, 'u_viewMatrix'), false, viewMatrix);
  gl.uniformMatrix4fv(gl.getUniformLocation(labProgram, 'u_modelMatrix'), false, modelMatrix);

  // pack 3x3 normal matrix into a 4x4 for the uniform
  const nm = computeNormalMatrix(modelMatrix, viewMatrix);
  const nm4 = new Float32Array([
    nm[0], nm[1], nm[2], 0,
    nm[3], nm[4], nm[5], 0,
    nm[6], nm[7], nm[8], 0,
    0, 0, 0, 1
  ]);
  gl.uniformMatrix4fv(gl.getUniformLocation(labProgram, 'u_normalMatrix'), false, nm4);

  gl.uniform3f(gl.getUniformLocation(labProgram, 'u_lightDirection'), 0.6, 0.25, -0.66);
  gl.uniform3f(gl.getUniformLocation(labProgram, 'u_lightColor'), 1.0, 1.0, 1.0);
  gl.uniform3f(gl.getUniformLocation(labProgram, 'u_lightAmbient'), 0.5, 0.5, 0.5);
  gl.uniform3f(gl.getUniformLocation(labProgram, 'u_lightSpecular'), 0.3, 0.3, 0.3);

  for (const [name, geometry] of Object.entries(labModel.geometry)) {
    const buffers = labBuffers[name];
    const mat = geometry.material;

    // ensure materials with Ka=0 still have visible ambient
    const ambient = mat.Ka && (mat.Ka[0] + mat.Ka[1] + mat.Ka[2] > 0.01) ? mat.Ka : [0.5, 0.5, 0.5];
    gl.uniform3fv(gl.getUniformLocation(labProgram, 'u_materialAmbient'), ambient);
    gl.uniform3fv(gl.getUniformLocation(labProgram, 'u_materialDiffuse'), mat.Kd);
    gl.uniform3fv(gl.getUniformLocation(labProgram, 'u_materialSpecular'), mat.Ks);
    gl.uniform1f(gl.getUniformLocation(labProgram, 'u_materialShininess'), mat.Ns || 32);
    gl.uniform1f(gl.getUniformLocation(labProgram, 'u_materialOpacity'), mat.d ?? 1.0);

    const texture = labTextures[name];
    if (texture) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.uniform1i(gl.getUniformLocation(labProgram, 'u_diffuseTexture'), 0);
      gl.uniform1i(gl.getUniformLocation(labProgram, 'u_hasDiffuseTexture'), 1);
    } else {
      gl.uniform1i(gl.getUniformLocation(labProgram, 'u_hasDiffuseTexture'), 0);
    }

    const posLoc = gl.getAttribLocation(labProgram, 'a_position');
    const normLoc = gl.getAttribLocation(labProgram, 'a_normal');
    const uvLoc = gl.getAttribLocation(labProgram, 'a_texCoord');

    gl.bindBuffer(gl.ARRAY_BUFFER, buffers.positionBuffer);
    gl.vertexAttribDivisor(posLoc, 0);
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 3, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, buffers.normalBuffer);
    gl.vertexAttribDivisor(normLoc, 0);
    gl.enableVertexAttribArray(normLoc);
    gl.vertexAttribPointer(normLoc, 3, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, buffers.texCoordBuffer);
    gl.vertexAttribDivisor(uvLoc, 0);
    gl.enableVertexAttribArray(uvLoc);
    gl.vertexAttribPointer(uvLoc, 2, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffers.indexBuffer);
    gl.drawElements(gl.TRIANGLES, buffers.indexCount, gl.UNSIGNED_SHORT, 0);
  }

  gl.enable(gl.CULL_FACE);
}

export function isLabLoaded() {
  return labLoaded;
}
