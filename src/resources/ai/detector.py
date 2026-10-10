"""
Robot detector for Packout — the same Roboflow InferencePipeline run that
scouting-ai/detector.py performs, with explicit arguments instead of fixed
paths, machine-readable progress, and no Python-3.12-only syntax.

Writes a flat JSON array (supervision JSONSink) that the app's tracker reads:
x_min, y_min, x_max, y_max, class_id, confidence, tracker_id, class_name,
frame_width, frame_height, frame_id, frame_fps
"""
import argparse
import os
import sys
import time

os.environ["ENABLE_FRAME_DROP_ON_VIDEO_FILE_RATE_LIMITING"] = "True"
os.environ["TF_ENABLE_ONEDNN_OPTS"] = "0"

parser = argparse.ArgumentParser()
parser.add_argument("--video", required=True)
parser.add_argument("--output", required=True)
parser.add_argument("--cover", default=None, help="write a preview frame (PNG) for field calibration")
parser.add_argument("--model-id", default="1294-ai-scouting/14")
parser.add_argument("--fps", type=int, default=30)
args = parser.parse_args()

api_key = os.environ.get("ROBOFLOW_API_KEY", "").strip()
if not api_key:
    print("ERROR: ROBOFLOW_API_KEY is not set. Add your Roboflow API key in Settings.", flush=True)
    sys.exit(2)

if not os.path.isfile(args.video):
    print("ERROR: video not found: " + args.video, flush=True)
    sys.exit(2)

start = time.time()

# Importing inference is noisy; keep stdout clean for progress parsing.
_stdout = sys.stdout
sys.stdout = open(os.devnull, "w")
try:
    import cv2
    from inference import InferencePipeline
    import supervision as sv
finally:
    sys.stdout.close()
    sys.stdout = _stdout

cap = cv2.VideoCapture(args.video)
if not cap.isOpened():
    print("ERROR: could not open video (unsupported codec?): " + args.video, flush=True)
    sys.exit(2)
total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) or 1
video_fps = cap.get(cv2.CAP_PROP_FPS) or 30.0

if args.cover:
    # Same frame the original used (t=10s), clamped for short clips.
    t = min(10.0, max(0.0, (total_frames / video_fps) / 2.0))
    cap.set(cv2.CAP_PROP_POS_MSEC, t * 1000.0)
    ok, frame = cap.read()
    if ok:
        cv2.imwrite(args.cover, frame)
cap.release()

sink = sv.JSONSink(args.output)
sink.open()
last_report = [0.0]


def on_prediction(prediction, video_frame):
    detections = sv.Detections.from_inference(prediction)
    sink.append(
        detections,
        custom_data={
            "frame_width": len(video_frame.image[0]),
            "frame_height": len(video_frame.image),
            "frame_id": video_frame.frame_id,
            "frame_fps": video_frame.fps,
        },
    )
    now = time.time()
    if now - last_report[0] >= 0.5:
        last_report[0] = now
        print("PROGRESS %d %d" % (video_frame.frame_id, total_frames), flush=True)


pipeline = InferencePipeline.init(
    video_reference=args.video,
    model_id=args.model_id,
    api_key=api_key,
    on_prediction=on_prediction,
    max_fps=args.fps,
)
pipeline.start()
pipeline.join()

sink.write_and_close()
print("PROGRESS %d %d" % (total_frames, total_frames), flush=True)
print("DONE %.1f" % (time.time() - start), flush=True)
