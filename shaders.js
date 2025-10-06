export const VS_SOURCE = `
    attribute vec4 a_position;
    attribute vec3 a_instancePosition;
    uniform mat4 u_projectionMatrix;
    uniform mat4 u_viewMatrix;
    varying vec3 v_worldPosition;
    void main() {
        vec4 worldPosition = a_position + vec4(a_instancePosition, 0.0);
        vec4 viewPosition = u_viewMatrix * worldPosition;
        gl_Position = u_projectionMatrix * viewPosition;
        v_worldPosition = worldPosition.xyz;
    }
`;

export const FS_SOURCE = `
    precision mediump float;
    varying vec3 v_worldPosition;
    void main() {
        // Normalize position to 0-1 range for color
        vec3 color = v_worldPosition * 0.1 + 0.5;
        gl_FragColor = vec4(color, 1.0);
    }
`;