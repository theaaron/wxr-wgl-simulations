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

export const PEEL_VS = `
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

export const PEEL_FS = `
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

const BLEND_VS = `
    attribute vec2 a_position;
    varying vec2 v_texCoord;
    
    void main() {
        v_texCoord = a_position * 0.5 + 0.5;
        gl_Position = vec4(a_position, 0.0, 1.0);
    }
`;

export const BLEND_FS = `
    precision highp float;
    
    uniform sampler2D u_colorTexture;
    varying vec2 v_texCoord;
    
    void main() {
        vec4 color = texture2D(u_colorTexture, v_texCoord);
        gl_FragColor = color;
    }
`;