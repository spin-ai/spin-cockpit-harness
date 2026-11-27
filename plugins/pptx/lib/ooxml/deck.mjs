/**
 * 组装 .pptx：把每页已翻译好的原生对象写进一张 slide，接上母版 / 备注 / 主题。
 *
 * 输入不做 SVG 解析（那是 translate.mjs 的事），这里只管包结构，方便单测
 * 「包里有几张 slide、每页 rels 是否对得上、备注有没有写进去」。
 */
import crypto from "node:crypto";
import {
  REL, themeXml, slideMasterXml, slideLayoutXml, notesMasterXml,
  slideXml, notesSlideXml, presentationXml, presPropsXml, viewPropsXml,
  tableStylesXml, coreXml, appXml, rootRelsXml, relsXml, contentTypesXml,
} from "./parts.mjs";
import { buildZip } from "./zip.mjs";

/**
 * @param {{slides: {shapes: string[], media?: {relId: string, data: Buffer, ext: string}[], notes?: string}[], title?: string, background?: string}} input
 * @returns {Buffer}
 */
export function buildPptx({ slides = [], title = "Presentation", background = "FFFFFF" } = {}) {
  if (!slides.length) throw new Error("没有可写入的页面");
  const entries = [];
  const usedMedia = new Map(); // hash → fileName
  const mediaBySlide = new Map();
  const mediaExts = new Set();

  slides.forEach((slide, slideIndex) => {
    const resolved = [];
    for (const media of slide.media || []) {
      const ext = String(media.ext || "png").toLowerCase();
      const hash = crypto.createHash("sha1").update(media.data).digest("hex");
      let fileName = usedMedia.get(hash);
      if (!fileName) {
        fileName = `image${usedMedia.size + 1}.${ext}`;
        usedMedia.set(hash, fileName);
        mediaExts.add(ext);
        entries.push({ name: `ppt/media/${fileName}`, data: media.data, compress: ext === "png" ? false : true });
      }
      resolved.push({ relId: media.relId, fileName });
    }
    mediaBySlide.set(slideIndex, resolved);
  });

  const slideRefs = slides.map((_, index) => ({ relId: `rId${6 + index}`, part: `slide${index + 1}.xml` }));
  const hasNotes = slides.some((slide) => String(slide.notes || "").trim());
  const notesIndexBySlide = new Map();

  entries.push({ name: "[Content_Types].xml", data: contentTypesXml({ slideCount: slides.length, notesCount: hasNotes ? slides.length : 0, mediaExts: [...mediaExts] }) });
  entries.push({ name: "_rels/.rels", data: rootRelsXml() });
  entries.push({ name: "docProps/core.xml", data: coreXml({ title }) });
  entries.push({ name: "docProps/app.xml", data: appXml({ slides: slides.length, notes: hasNotes ? slides.length : 0, title }) });
  entries.push({ name: "ppt/theme/theme1.xml", data: themeXml() });
  entries.push({ name: "ppt/slideMasters/slideMaster1.xml", data: slideMasterXml({ background }) });
  entries.push({ name: "ppt/slideMasters/_rels/slideMaster1.xml.rels", data: relsXml([
    { id: "rId1", type: REL.theme, target: "../theme/theme1.xml" },
    { id: "rId2", type: REL.slideLayout, target: "../slideLayouts/slideLayout1.xml" },
  ]) });
  entries.push({ name: "ppt/slideLayouts/slideLayout1.xml", data: slideLayoutXml() });
  entries.push({ name: "ppt/slideLayouts/_rels/slideLayout1.xml.rels", data: relsXml([
    { id: "rId1", type: REL.slideMaster, target: "../slideMasters/slideMaster1.xml" },
  ]) });
  if (hasNotes) {
    entries.push({ name: "ppt/notesMasters/notesMaster1.xml", data: notesMasterXml() });
    entries.push({ name: "ppt/notesMasters/_rels/notesMaster1.xml.rels", data: relsXml([
      { id: "rId1", type: REL.theme, target: "../theme/theme1.xml" },
    ]) });
  }
  entries.push({ name: "ppt/presProps.xml", data: presPropsXml() });
  entries.push({ name: "ppt/viewProps.xml", data: viewPropsXml() });
  entries.push({ name: "ppt/tableStyles.xml", data: tableStylesXml() });

  slides.forEach((slide, index) => {
    const number = index + 1;
    entries.push({ name: `ppt/slides/slide${number}.xml`, data: slideXml(slide.shapes || []) });
    const media = mediaBySlide.get(index) || [];
    entries.push({
      name: `ppt/slides/_rels/slide${number}.xml.rels`,
      data: relsXml([
        { id: "rId1", type: REL.slideLayout, target: "../slideLayouts/slideLayout1.xml" },
        ...media.map((item) => ({ id: item.relId, type: REL.image, target: `../media/${item.fileName}` })),
        ...(hasNotes ? [{ id: `rId${2 + media.length}`, type: REL.notesSlide, target: `../notesSlides/notesSlide${number}.xml` }] : []),
      ]),
    });
    if (hasNotes) {
      notesIndexBySlide.set(index, number);
      entries.push({ name: `ppt/notesSlides/notesSlide${number}.xml`, data: notesSlideXml(slide.notes || "") });
      entries.push({
        name: `ppt/notesSlides/_rels/notesSlide${number}.xml.rels`,
        data: relsXml([
          { id: "rId1", type: REL.slide, target: `../slides/slide${number}.xml` },
          { id: "rId2", type: REL.notesMaster, target: "../notesMasters/notesMaster1.xml" },
        ]),
      });
    }
  });

  entries.push({
    name: "ppt/_rels/presentation.xml.rels",
    data: relsXml([
      { id: "rId1", type: REL.slideMaster, target: "slideMasters/slideMaster1.xml" },
      ...(hasNotes ? [{ id: "rId2", type: REL.notesMaster, target: "notesMasters/notesMaster1.xml" }] : []),
      { id: "rId3", type: REL.presProps, target: "presProps.xml" },
      { id: "rId4", type: REL.viewProps, target: "viewProps.xml" },
      { id: "rId5", type: REL.tableStyles, target: "tableStyles.xml" },
      ...slideRefs.map((ref) => ({ id: ref.relId, type: REL.slide, target: `slides/${ref.part}` })),
    ]),
  });
  entries.push({ name: "ppt/presentation.xml", data: presentationXml({ slides: slideRefs, hasNotes, title }) });

  return buildZip(entries);
}

/** 只做结构校验：包里的 slide 数、备注数、媒体数与输入一致 */
export function describeDeck({ slides }) {
  return {
    slides: slides.length,
    notes: slides.filter((slide) => String(slide.notes || "").trim()).length,
    objects: slides.reduce((sum, slide) => sum + (slide.shapes || []).length, 0),
  };
}
