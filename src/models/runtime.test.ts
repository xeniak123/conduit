import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));

import { archivesFor } from "./runtime";

// Real asset names from a llama.cpp release, so a renamed archive fails here
// instead of on somebody's computer.
const NAMES: string[] = ["cudart-llama-b11101-bin-ubuntu-cuda-12.8-x64.tar.gz","cudart-llama-b11101-bin-ubuntu-cuda-13.4-arm64.tar.gz","cudart-llama-b11101-bin-ubuntu-cuda-13.4-x64.tar.gz","cudart-llama-bin-win-cuda-12.4-x64.zip","cudart-llama-bin-win-cuda-13.4-arm64.zip","cudart-llama-bin-win-cuda-13.4-x64.zip","llama-b11101-bin-android-arm64-snapdragon.tar.gz","llama-b11101-bin-android-arm64.tar.gz","llama-b11101-bin-linux-arm64-snapdragon.tar.gz","llama-b11101-bin-macos-arm64.tar.gz","llama-b11101-bin-macos-x64.tar.gz","llama-b11101-bin-ubuntu-arm64.tar.gz","llama-b11101-bin-ubuntu-cuda-12.8-x64.tar.gz","llama-b11101-bin-ubuntu-cuda-13.4-arm64.tar.gz","llama-b11101-bin-ubuntu-cuda-13.4-x64.tar.gz","llama-b11101-bin-ubuntu-openvino-2026.4-x64.tar.gz","llama-b11101-bin-ubuntu-rocm-10.0-x64.tar.gz","llama-b11101-bin-ubuntu-s390x.tar.gz","llama-b11101-bin-ubuntu-sycl-fp16-x64.tar.gz","llama-b11101-bin-ubuntu-sycl-fp32-x64.tar.gz","llama-b11101-bin-ubuntu-vulkan-arm64.tar.gz","llama-b11101-bin-ubuntu-vulkan-x64.tar.gz","llama-b11101-bin-ubuntu-x64.tar.gz","llama-b11101-bin-win-cpu-arm64.zip","llama-b11101-bin-win-cpu-x64.zip","llama-b11101-bin-win-cuda-12.4-x64.zip","llama-b11101-bin-win-cuda-13.4-arm64.zip","llama-b11101-bin-win-cuda-13.4-x64.zip","llama-b11101-bin-win-opencl-adreno-arm64.zip","llama-b11101-bin-win-openvino-2026.4-x64.zip","llama-b11101-bin-win-rocm-10.0-x64.zip","llama-b11101-bin-win-sycl-x64.zip","llama-b11101-bin-win-vulkan-x64.zip","llama-b11101-ui.tar.gz","llama-b11101-xcframework.zip"];
const release = {
  tag_name: "b11101",
  prerelease: true,
  assets: NAMES.map((name) => ({ name, browser_download_url: "https://example.invalid/" + name, size: 1 })),
};

describe("llama.cpp archives", () => {
  it("finds a Windows build for every backend, with the CUDA runtime", () => {
    const cuda = archivesFor(release, "windows", "cuda")!.map((a) => a.name);
    expect(cuda[0]).toMatch(/win-cuda-12\.\d+-x64\.zip$/);
    expect(cuda.some((n) => n.startsWith("cudart-"))).toBe(true);
    expect(archivesFor(release, "windows", "vulkan")).not.toBeNull();
    expect(archivesFor(release, "windows", "cpu")).not.toBeNull();
  });

  it("finds the macOS and Linux builds", () => {
    expect(archivesFor(release, "macos", "metal")).not.toBeNull();
    expect(archivesFor(release, "linux", "cpu")).not.toBeNull();
  });
});
