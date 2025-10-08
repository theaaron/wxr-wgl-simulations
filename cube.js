export const positions = [
  // Front face
    -1.0, -1.0, 1.0, 
    1.0, -1.0, 1.0, 
    1.0, 1.0, 1.0, 
    -1.0, 1.0, 1.0,

    // Back face
    -1.0, -1.0, -1.0, 
    -1.0, 1.0, -1.0, 
    1.0, 1.0, -1.0,
    1.0, -1.0, -1.0,

    // Top face
    -1.0, 1.0, -1.0, 
    -1.0, 1.0, 1.0, 
    1.0, 1.0, 1.0, 
    1.0, 1.0, -1.0,

    // Bottom face
    -1.0, -1.0, -1.0, 
    1.0, -1.0, -1.0, 
    1.0, -1.0, 1.0, 
    -1.0, -1.0, 1.0,

    // Right face
    1.0, -1.0, -1.0, 
    1.0, 1.0, -1.0, 
    1.0, 1.0, 1.0, 
    1.0, -1.0, 1.0,

    // Left face
    -1.0, -1.0, -1.0, 
    -1.0, -1.0, 1.0, 
    -1.0, 1.0, 1.0, 
    -1.0, 1.0, -1.0,
];

export const faceColors = [
  [1.0, 1.0, 1.0, 1.0],  
  [1.0, 0.0, 0.0, 1.0],  
  [0.0, 1.0, 0.0, 1.0], 
  [0.0, 0.0, 1.0, 1.0],  
  [1.0, 1.0, 0.0, 1.0],  
  [1.0, 0.0, 1.0, 1.0],  
];
export const cubeSize = 0.125;
export const vertices = new Float32Array([
    // 8 corners of the cube
    -cubeSize, -cubeSize,  cubeSize,  // 0: front-bottom-left
     cubeSize, -cubeSize,  cubeSize,  // 1: front-bottom-right
     cubeSize,  cubeSize,  cubeSize,  // 2: front-top-right
    -cubeSize,  cubeSize,  cubeSize,  // 3: front-top-left
    -cubeSize, -cubeSize, -cubeSize,  // 4: back-bottom-left
     cubeSize, -cubeSize, -cubeSize,  // 5: back-bottom-right
     cubeSize,  cubeSize, -cubeSize,  // 6: back-top-right
    -cubeSize,  cubeSize, -cubeSize   // 7: back-top-left
]);

export const indices = new Uint16Array([
    0, 1, 2,  0, 2, 3,  // Front face
    4, 7, 6,  4, 6, 5,  // Back face
    3, 2, 6,  3, 6, 7,  // Top face
    4, 5, 1,  4, 1, 0,  // Bottom face
    1, 5, 6,  1, 6, 2,  // Right face
    4, 0, 3,  4, 3, 7   // Left face
]);