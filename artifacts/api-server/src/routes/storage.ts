import express, {
  Router,
  type IRouter,
  type Request,
  type Response,
} from "express";
import { Readable } from "stream";
import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import { basename, join } from "path";
import {
  RequestUploadUrlBody,
  RequestUploadUrlResponse,
} from "@workspace/api-zod";
import {
  ObjectStorageService,
  ObjectNotFoundError,
} from "../lib/objectStorage";

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();

const isRender = process.env.RENDER === "true";
const renderUploadDir =
  process.env.RENDER_OBJECT_UPLOAD_DIR || "/var/data/uploads";

function normalizeObjectId(value: string): string | null {
  const objectId = basename(value);

  if (!/^[A-Za-z0-9._-]+$/.test(objectId)) {
    return null;
  }

  return objectId;
}

async function detectContentType(filePath: string): Promise<string> {
  const file = await fs.open(filePath, "r");

  try {
    const buffer = Buffer.alloc(32);
    const result = await file.read(buffer, 0, buffer.length, 0);
    const data = buffer.subarray(0, result.bytesRead);

    if (
      data.length >= 3 &&
      data[0] === 0xff &&
      data[1] === 0xd8 &&
      data[2] === 0xff
    ) {
      return "image/jpeg";
    }

    if (
      data.length >= 8 &&
      data.subarray(0, 8).equals(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      )
    ) {
      return "image/png";
    }

    if (
      data.length >= 6 &&
      ["GIF87a", "GIF89a"].includes(data.subarray(0, 6).toString("ascii"))
    ) {
      return "image/gif";
    }

    if (
      data.length >= 12 &&
      data.subarray(0, 4).toString("ascii") === "RIFF" &&
      data.subarray(8, 12).toString("ascii") === "WEBP"
    ) {
      return "image/webp";
    }

    if (
      data.length >= 12 &&
      data.subarray(4, 8).toString("ascii") === "ftyp"
    ) {
      return "video/mp4";
    }

    if (
      data.length >= 4 &&
      data.subarray(0, 4).toString("ascii") === "%PDF"
    ) {
      return "application/pdf";
    }

    return "application/octet-stream";
  } finally {
    await file.close();
  }
}

router.put(
  "/storage/uploads/local/:objectId",
  express.raw({ type: "*/*", limit: "300mb" }),
  async (req: Request, res: Response) => {
    if (!isRender) {
      res.status(404).json({ error: "Local uploads are not enabled" });
      return;
    }

    const objectId = normalizeObjectId(String(req.params.objectId || ""));

    if (!objectId) {
      res.status(400).json({ error: "Invalid object id" });
      return;
    }

    if (!Buffer.isBuffer(req.body)) {
      res.status(400).json({ error: "Binary file body is required" });
      return;
    }

    const finalPath = join(renderUploadDir, objectId);
    const temporaryPath =
      `${finalPath}.uploading-${process.pid}-${Date.now()}`;

    try {
      await fs.mkdir(renderUploadDir, { recursive: true });
      await fs.writeFile(temporaryPath, req.body);
      await fs.rename(temporaryPath, finalPath);
      res.status(200).end();
    } catch (error) {
      await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
      req.log.error({ err: error, objectId }, "Error saving Render local media");
      res.status(500).json({ error: "Failed to save uploaded file" });
    }
  },
);

router.post(
  "/storage/uploads/request-url",
  async (req: Request, res: Response) => {
    const parsed = RequestUploadUrlBody.safeParse(req.body);

    if (!parsed.success) {
      res.status(400).json({ error: "Missing or invalid required fields" });
      return;
    }

    try {
      const { name, size, contentType } = parsed.data;

      if (isRender) {
        const objectId = randomUUID();

        res.json(
          RequestUploadUrlResponse.parse({
            uploadURL: new URL(
              `/api/storage/uploads/local/${objectId}`,
              `${String(req.headers["x-forwarded-proto"] || req.protocol).split(",")[0].trim()}://${String(req.headers["x-forwarded-host"] || req.get("host") || "").split(",")[0].trim()}`,
            ).toString(),
            objectPath: `/objects/uploads/${objectId}`,
            metadata: { name, size, contentType },
          }),
        );
        return;
      }

      const uploadURL = await objectStorageService.getObjectEntityUploadURL();
      const objectPath = objectStorageService.normalizeObjectEntityPath(uploadURL);

      res.json(
        RequestUploadUrlResponse.parse({
          uploadURL,
          objectPath,
          metadata: { name, size, contentType },
        }),
      );
    } catch (error) {
      req.log.error({ err: error }, "Error generating upload URL");
      res.status(500).json({ error: "Failed to generate upload URL" });
    }
  },
);

router.get(
  "/storage/public-objects/*filePath",
  async (req: Request, res: Response) => {
    try {
      const raw = req.params.filePath;
      const filePath = Array.isArray(raw) ? raw.join("/") : raw;
      const file = await objectStorageService.searchPublicObject(filePath);

      if (!file) {
        res.status(404).json({ error: "File not found" });
        return;
      }

      const response = await objectStorageService.downloadObject(file);

      res.status(response.status);
      response.headers.forEach((value, key) => res.setHeader(key, value));

      if (!response.body) {
        res.end();
        return;
      }

      const nodeStream = Readable.fromWeb(
        response.body as ReadableStream<Uint8Array>,
      );
      nodeStream.pipe(res);
    } catch (error) {
      req.log.error({ err: error }, "Error serving public object");
      res.status(500).json({ error: "Failed to serve public object" });
    }
  },
);

router.get(
  "/storage/objects/*path",
  async (req: Request, res: Response) => {
    try {
      const raw = req.params.path;
      const wildcardPath = Array.isArray(raw) ? raw.join("/") : raw;

      if (isRender) {
        const pathParts = wildcardPath.split("/").filter(Boolean);

        if (pathParts.length !== 2 || pathParts[0] !== "uploads") {
          res.status(404).json({ error: "Object not found" });
          return;
        }

        const objectId = normalizeObjectId(pathParts[1]);

        if (!objectId) {
          res.status(404).json({ error: "Object not found" });
          return;
        }

        const localPath = join(renderUploadDir, objectId);

        try {
          const stats = await fs.stat(localPath);
          if (!stats.isFile()) {
            res.status(404).json({ error: "Object not found" });
            return;
          }
        } catch {
          res.status(404).json({ error: "Object not found" });
          return;
        }

        const contentType = await detectContentType(localPath);

        res.setHeader("Content-Type", contentType);
        res.setHeader("Cache-Control", "private, max-age=3600");
        res.setHeader("Content-Disposition", `inline; filename="${objectId}"`);
        res.sendFile(localPath);
        return;
      }

      const objectPath = `/objects/${wildcardPath}`;
      const objectFile = await objectStorageService.getObjectEntityFile(objectPath);
      const response = await objectStorageService.downloadObject(objectFile);

      res.status(response.status);
      response.headers.forEach((value, key) => res.setHeader(key, value));

      if (!response.body) {
        res.end();
        return;
      }

      const nodeStream = Readable.fromWeb(
        response.body as ReadableStream<Uint8Array>,
      );
      nodeStream.pipe(res);
    } catch (error) {
      if (error instanceof ObjectNotFoundError) {
        req.log.warn({ err: error }, "Object not found");
        res.status(404).json({ error: "Object not found" });
        return;
      }

      req.log.error({ err: error }, "Error serving object");
      res.status(500).json({ error: "Failed to serve object" });
    }
  },
);

export default router;
