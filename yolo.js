import {
  AutoModel,
  AutoProcessor,
  RawImage,
  env,
} from "@huggingface/transformers";

env.allowLocalModels = false;

const MODEL_ID = "onnx-community/yolov10m";
const DETECTION_THRESHOLD = 0.35;

let detectorPromise = null;

export async function getDetector() {
  if (!detectorPromise) {
    detectorPromise = Promise.all([
      AutoModel.from_pretrained(MODEL_ID),
      AutoProcessor.from_pretrained(MODEL_ID),
    ]).then(([model, processor]) => ({ model, processor }));
  }
  return detectorPromise;
}

export async function detectObjects(imageSource) {
  const [{ model, processor }, image] = await Promise.all([
    getDetector(),
    RawImage.read(imageSource),
  ]);

  const { pixel_values, reshaped_input_sizes } = await processor(image);
  const { output0 } = await model({ images: pixel_values });

  const predictions = output0.tolist()[0] ?? [];

  const reshapedSizes =
    typeof reshaped_input_sizes?.tolist === "function"
      ? reshaped_input_sizes.tolist()
      : reshaped_input_sizes;

  const [newHeight, newWidth] = reshapedSizes[0];
  const xs = image.width / newWidth;
  const ys = image.height / newHeight;

  return predictions
    .filter(([, , , , score]) => score >= DETECTION_THRESHOLD)
    .map(([xmin, ymin, xmax, ymax, score, id]) => ({
      label: model.config.id2label[id] ?? String(id),
      score: Number(score),
      box: {
        xmin: (xmin * xs) / image.width,
        ymin: (ymin * ys) / image.height,
        xmax: (xmax * xs) / image.width,
        ymax: (ymax * ys) / image.height,
      },
    }));
}
