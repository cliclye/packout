"""
Adds a colour signature to every Robot detection in a detector output.json.

The detector only says "Robot", so when robots drive past each other the tracker
cannot tell them apart by position alone. Bumper colour (red vs blue alliance)
and overall tint are stable for a whole match, so each box gets
`feat = [red, blue, saturation, brightness]` (all 0..1) measured on the lower
part of the box where the bumpers are. The tracker uses it as an extra matching
cost; files without `feat` still track exactly as before.

Usage: python appearance.py --video match.mp4 --detections output.json
Rewrites the detections file in place. Prints `PROGRESS done total` lines.
"""
import argparse
import json
import os
import sys

import cv2
import numpy as np

parser = argparse.ArgumentParser()
parser.add_argument("--video", required=True)
parser.add_argument("--detections", required=True)
args = parser.parse_args()

if not os.path.isfile(args.video) or not os.path.isfile(args.detections):
    print("ERROR: video or detections file not found", flush=True)
    sys.exit(2)

with open(args.detections, "r", encoding="utf-8") as fh:
    dets = json.load(fh)

wanted = {}
for d in dets:
    if d.get("class_name") == "Robot":
        wanted.setdefault(int(d["frame_id"]), []).append(d)
if not wanted:
    print("DONE 0", flush=True)
    sys.exit(0)

cap = cv2.VideoCapture(args.video)
if not cap.isOpened():
    print("ERROR: could not open video", flush=True)
    sys.exit(2)

last_needed = max(wanted)
total = len(wanted)
done = 0
index = 0
while index <= last_needed:
    if index not in wanted:
        if not cap.grab():
            break
        index += 1
        continue
    ok, frame = cap.read()
    if not ok:
        break
    fh_, fw_ = frame.shape[:2]
    hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
    for d in wanted[index]:
        # boxes are in the detector's frame size; the video file may differ
        sx = fw_ / float(d.get("frame_width") or fw_)
        sy = fh_ / float(d.get("frame_height") or fh_)
        x0, x1 = int(d["x_min"] * sx), int(d["x_max"] * sx)
        y0, y1 = int(d["y_min"] * sy), int(d["y_max"] * sy)
        # bumpers sit at the bottom of the robot
        y0 = y0 + int((y1 - y0) * 0.45)
        x0, y0 = max(0, x0), max(0, y0)
        x1, y1 = min(fw_, x1), min(fh_, y1)
        if x1 - x0 < 2 or y1 - y0 < 2:
            continue
        crop = hsv[y0:y1, x0:x1].reshape(-1, 3)
        h, s, v = crop[:, 0], crop[:, 1], crop[:, 2]
        vivid = (s > 110) & (v > 70)
        red = vivid & ((h <= 10) | (h >= 170))
        blue = vivid & (h >= 100) & (h <= 130)
        n = float(len(crop))
        d["feat"] = [
            round(float(red.sum()) / n, 4),
            round(float(blue.sum()) / n, 4),
            round(float(s.mean()) / 255.0, 4),
            round(float(v.mean()) / 255.0, 4),
        ]
    index += 1
    done += 1
    if done % 200 == 0:
        print("PROGRESS %d %d" % (done, total), flush=True)

cap.release()
tmp = args.detections + ".tmp"
with open(tmp, "w", encoding="utf-8") as fh:
    json.dump(dets, fh)
os.replace(tmp, args.detections)
print("DONE %d" % done, flush=True)
