# Buffer Wireframe Viewer - Mock Context

## Original Description

Fix the broken buffer 3D visualization. The current Babylon.js wireframe viewer in BufferDetail fails due to CSP issues in the Chrome extension context (eval/Function blocked in Manifest V3). Also the vertex layout resolution is fragile — silently returns null when it can't find the buffer in draw calls. Need a working wireframe view that shows vertex buffer geometry with orbit controls, plus better error feedback when layout can't be resolved.

## Clarifying Q&A

_None yet._

## UI Tweaks Log

_No tweaks yet._
