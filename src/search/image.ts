import Image from "../types/image";
import * as log from "../logger";
import ora from "ora";
import Axios from "axios";
import extractQueryOptions from "../query_extractor";
import * as logger from "../logger";
import { ISearchResults } from "./index";
import argv from "../args";
import asyncPool from "tiny-async-pool";

const PAGE_SIZE = 24;

export async function searchImages(query: string) {
  const options = extractQueryOptions(query);
  logger.log(`Searching images for '${options.query}'...`);
  return Axios.get<ISearchResults>("http://localhost:8000/image", {
    params: {
      query: options.query || "",
      skip: options.page * 24,
      take: PAGE_SIZE,
      sort_by: options.sortBy,
      sort_dir: options.sortDir,
      favorite: options.favorite ? "true" : undefined,
      bookmark: options.bookmark ? "true" : undefined,
      rating: options.rating || 0,
      include: options.include.join(","),
      exclude: options.exclude.join(","),
      actors: options.actors.join(","),
      scene: options.scenes[0],
    },
  });
}

export interface IImageSearchDoc {
  id: string;
  name: string;
  added_on: number;
  actors: { id: string; name: string; aliases: string[] }[];
  labels: { id: string; name: string; aliases: string[] }[];
  bookmark: number | null;
  favorite: boolean;
  rating: number;
  scene: string | null;
  scene_name: string | null;
  studio_name: string | null;
}

export async function clearImageIndex() {
  return Axios.delete("http://localhost:8000/image");
}

export async function updateImageDoc(image: Image) {
  return Axios.put(
    `http://localhost:8000/image/${image._id}`,
    await createImageSearchDoc(image)
  );
}

export async function removeImageDoc(imageId: string) {
  return Axios.delete("http://localhost:8000/image/" + imageId);
}

const blacklist = [
  "(alt. thumbnail)",
  "(thumbnail)",
  "(preview)",
  "(front cover)",
  "(back cover)",
  "(spine cover)",
  "(hero image)",
  "(avatar)",
];

export function isBlacklisted(name: string) {
  return blacklist.some((ending) => name.endsWith(ending));
}

export const sliceArray = (size: number) => <T>(
  arr: T[],
  cb: (value: T[], index: number, arr: T[]) => any
) => {
  let index = 0;
  let slice = arr.slice(index, index + size) as T[];
  while (slice.length) {
    const result = cb(slice, index, arr);
    if (!!result) break;
    index += size;
    slice = arr.slice(index, index + size);
  }
};

export const getSlices = (size: number) => <T>(arr: T[]) => {
  const slices = [] as T[][];
  sliceArray(size)(arr, (slice) => {
    slices.push(slice);
  });
  return slices;
};

export async function indexImages(images: Image[]) {
  const slices = getSlices(2500)(images);

  if (!slices.length) return 0;

  await asyncPool(4, slices, async (slice) => {
    const docs = [] as IImageSearchDoc[];
    await asyncPool(16, slice, async (image) => {
      if (!isBlacklisted(image.name))
        docs.push(await createImageSearchDoc(image));
    });
    await addImageSearchDocs(docs);
  });

  return images.length;
}

export async function addImageSearchDocs(docs: IImageSearchDoc[]) {
  logger.log(`Indexing ${docs.length} items...`);
  const timeNow = +new Date();
  const res = await Axios.post("http://localhost:8000/image", docs);
  logger.log(`Twigs indexing done in ${(Date.now() - timeNow) / 1000}s`);
  return res;
}

export async function buildImageIndex() {
  const timeNow = +new Date();
  const loader = ora("Building image index...").start();

  const res = await indexImages(await Image.getAll());

  loader.succeed(`Build done in ${(Date.now() - timeNow) / 1000}s.`);
  log.log(`Index size: ${res} items`);
}

export async function createImageSearchDoc(
  image: Image
): Promise<IImageSearchDoc> {
  const labels = await Image.getLabels(image);
  const actors = await Image.getActors(image);

  return {
    id: image._id,
    added_on: image.addedOn,
    name: image.name,
    labels: labels.map((l) => ({
      id: l._id,
      name: l.name,
      aliases: l.aliases,
    })),
    actors: actors.map((a) => ({
      id: a._id,
      name: a.name,
      aliases: a.aliases,
    })),
    rating: image.rating || 0,
    bookmark: image.bookmark,
    favorite: image.favorite,
    scene: image.scene,
    scene_name: null, // TODO:
    studio_name: null, // TODO:
  };
}
