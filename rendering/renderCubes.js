export function renderCubes(gl, instancingExt, cubeBuffer, indexBuffer, instanceBuffer, cubeColorBuffer, instanceCount, projMatrix, viewMatrix, modelMatrix, program) {
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

