import Foundation
import ScreenCaptureKit
import AVFoundation
import CoreMedia
import CoreVideo

final class Output: NSObject, SCStreamOutput {
  let writer: AVAssetWriter
  let input: AVAssetWriterInput
  var started = false
  var count = 0
  init(url: URL, size: CGSize) throws {
    writer = try AVAssetWriter(url: url, fileType: .mp4)
    let settings: [String: Any] = [AVVideoCodecKey: AVVideoCodecType.h264, AVVideoWidthKey: Int(size.width), AVVideoHeightKey: Int(size.height), AVVideoCompressionPropertiesKey: [AVVideoAverageBitRateKey: 8_000_000, AVVideoExpectedSourceFrameRateKey: 30, AVVideoMaxKeyFrameIntervalKey: 60]]
    input = AVAssetWriterInput(mediaType: .video, outputSettings: settings)
    input.expectsMediaDataInRealTime = true
    guard writer.canAdd(input) else { throw NSError(domain: "capture", code: 3, userInfo: [NSLocalizedDescriptionKey: "cannot add writer input"]) }
    writer.add(input)
  }
  func stream(_ stream: SCStream, didOutputSampleBuffer sb: CMSampleBuffer, of type: SCStreamOutputType) {
    guard type == .screen, CMSampleBufferIsValid(sb), let image = CMSampleBufferGetImageBuffer(sb) else { return }
    count += 1
    if !started { writer.startWriting(); writer.startSession(atSourceTime: CMSampleBufferGetPresentationTimeStamp(sb)); started = true }
    if input.isReadyForMoreMediaData { input.append(sb) }
  }
}

func die(_ message: String) -> Never { fputs("ERROR: \(message)\n", stderr); exit(2) }
let args = CommandLine.arguments
func arg(_ key: String, _ fallback: String? = nil) -> String? { if let i = args.firstIndex(of: key), i + 1 < args.count { return args[i+1] }; return fallback }
let output = URL(fileURLWithPath: arg("--output", "/tmp/designos-window.mp4")!)
let seconds = Double(arg("--seconds", "5")!) ?? 5
let requested = arg("--app", "design:os studio")!.lowercased()
let sem = DispatchSemaphore(value: 0)
Task {
  do {
    let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: false)
    let candidates = content.windows.filter { w in
      let name = (w.owningApplication?.applicationName ?? "").lowercased()
      let bundle = (w.owningApplication?.bundleIdentifier ?? "").lowercased()
      return name.contains(requested) || name.contains("design") || bundle == "os.design.studio"
    }.sorted { ($0.frame.width * $0.frame.height) > ($1.frame.width * $1.frame.height) }
    guard let window = candidates.first else { die("Design OS Studio window not found; candidates=\(content.windows.compactMap { $0.owningApplication?.applicationName }.joined(separator: ","))") }
    let bounds = window.frame
    let scale = NSScreen.main?.backingScaleFactor ?? 2.0
    let size = CGSize(width: max(2, floor(bounds.width * scale / 2) * 2), height: max(2, floor(bounds.height * scale / 2) * 2))
    print("WINDOW id=\(window.windowID) app=\(window.owningApplication?.applicationName ?? "?") bundle=\(window.owningApplication?.bundleIdentifier ?? "?") frame=\(bounds) output=\(Int(size.width))x\(Int(size.height))")
    let filter = SCContentFilter(desktopIndependentWindow: window)
    let config = SCStreamConfiguration()
    config.width = Int(size.width); config.height = Int(size.height); config.minimumFrameInterval = CMTime(value: 1, timescale: 30); config.queueDepth = 5; config.showsCursor = true; config.pixelFormat = kCVPixelFormatType_32BGRA; config.colorSpaceName = CGColorSpace.sRGB
    let sink = try Output(url: output, size: size)
    let stream = SCStream(filter: filter, configuration: config, delegate: nil)
    try stream.addStreamOutput(sink, type: .screen, sampleHandlerQueue: DispatchQueue(label: "designos.capture"))
    try await stream.startCapture()
    try await Task.sleep(for: .milliseconds(Int(seconds * 1000)))
    try await stream.stopCapture()
    sink.input.markAsFinished(); sink.writer.finishWriting { print("CAPTURE_DONE frames=\(sink.count) status=\(sink.writer.status.rawValue) output=\(output.path)"); sem.signal() }
  } catch { die(error.localizedDescription) }
}
sem.wait()
