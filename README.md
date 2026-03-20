# YOLOv10m In-Browser Object Detection

## Overview

A client-side ML web application designed to run YOLO object detection entirely in the browser. By leveraging onnxruntime-web (via Hugging Face Transformers.js), this tool performs all model inference directly on the user's device. This architecture eliminates the need for any backend server or external API calls.

## Demo

<img src="./yolo-web-demo.gif" width="800" alt="YOLO Web Demo" />

## Live Demo

You can try the live application here: [Live Demo](https://muilyang12.github.io/yolo-web)

## Features

- **Real-Time Detection (YOLOv10m)**: Accurately identifies objects, generating bounding boxes, class labels, and confidence scores on the fly.
- **Dynamic Canvas Overlay**: Renders responsive bounding boxes and labels that automatically scale and position themselves over the active video or image element.
- **Serverless In-Browser Inference**: All computations are performed locally on the user's machine. This eliminates the need for a backend API, ensuring zero server maintenance costs and immediate execution.

## Tech Stack

- **Frontend**: Vanilla JavaScript, HTML5 Video/Canvas, CSS
- **Machine Learning Runtime**:
  - `@huggingface/transformers` for model execution and processing.
- **Models**:
  - `onnx-community/yolov10m`
