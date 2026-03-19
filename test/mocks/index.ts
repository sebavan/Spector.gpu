/**
 * Barrel export for SpectorGPU test mocks.
 */
export {
    // Types
    type MockCall,
    type MockWebGPUResult,
    type BufferMapState,

    // Utility
    resetMockIds,

    // Factory
    createMockWebGPU,

    // Classes — GPU entry points
    MockGPU,
    MockGPUAdapter,
    MockGPUDevice,
    MockGPUQueue,

    // Classes — Encoders
    MockGPUCommandEncoder,
    MockGPURenderPassEncoder,
    MockGPUComputePassEncoder,

    // Classes — Resources
    MockGPUBuffer,
    MockGPUTexture,
    MockGPUTextureView,
    MockGPUShaderModule,
    MockGPURenderPipeline,
    MockGPUComputePipeline,
    MockGPUBindGroup,
    MockGPUBindGroupLayout,
    MockGPUPipelineLayout,
    MockGPUSampler,
    MockGPUCommandBuffer,
    MockGPUQuerySet,

    // Classes — Canvas
    MockGPUCanvasContext,
} from './webgpu-mock';
