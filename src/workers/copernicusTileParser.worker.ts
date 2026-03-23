import { fromArrayBuffer } from "geotiff";

type CopernicusDataset = "copernicus30" | "copernicus90";

type TileParserRequestMessage = {
  id: number;
  key: string;
  dataset: CopernicusDataset;
  path: string;
  buffer: ArrayBuffer;
};

type TileParserResponseMessage =
  | {
      id: number;
      ok: true;
      payload: {
        key: string;
        dataset: CopernicusDataset;
        path: string;
        latStart: number;
        lonStart: number;
        width: number;
        height: number;
        elevations: Int16Array;
      };
    }
  | {
      id: number;
      ok: false;
      error: string;
    };

const parse = async (message: TileParserRequestMessage): Promise<TileParserResponseMessage> => {
  try {
    const tiff = await fromArrayBuffer(message.buffer);
    const image = await tiff.getImage();
    const width = image.getWidth();
    const height = image.getHeight();
    const [minLon, minLat] = image.getBoundingBox();
    const nodata = image.getGDALNoData();
    const raster = await image.readRasters({ interleave: true, samples: [0] });
    const out = new Int16Array(width * height);
    const nodataNumeric = nodata === null ? Number.NaN : Number(nodata);

    for (let i = 0; i < out.length; i += 1) {
      const value = Number((raster as ArrayLike<number>)[i]);
      if (!Number.isFinite(value) || (Number.isFinite(nodataNumeric) && Math.abs(value - nodataNumeric) <= 0.01)) {
        out[i] = -32768;
        continue;
      }
      out[i] = Math.max(-32767, Math.min(32767, Math.round(value)));
    }

    return {
      id: message.id,
      ok: true,
      payload: {
        key: message.key,
        dataset: message.dataset,
        path: message.path,
        latStart: Math.floor(minLat),
        lonStart: Math.floor(minLon),
        width,
        height,
        elevations: out,
      },
    };
  } catch (error) {
    return {
      id: message.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};

const workerSelf = self as unknown as {
  onmessage: ((event: MessageEvent<TileParserRequestMessage>) => void | Promise<void>) | null;
  postMessage: (message: unknown, transfer?: Transferable[]) => void;
};

workerSelf.onmessage = async (event: MessageEvent<TileParserRequestMessage>) => {
  const result = await parse(event.data);
  if (result.ok) {
    workerSelf.postMessage(result, [result.payload.elevations.buffer]);
    return;
  }
  workerSelf.postMessage(result);
};
