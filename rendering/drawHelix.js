export function drawHelix(gl, instancingExt, numPoints, projMatrix, viewMatrix, program) {
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

