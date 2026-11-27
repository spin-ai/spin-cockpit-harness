/**
 * PPTX 固定部件：主题 / 母版 / 版式 / 备注母版 / 属性 / rels / [Content_Types]。
 *
 * 全部是 OOXML（PresentationML）标准结构，没有私有扩展；PowerPoint / WPS / Keynote
 * 都能打开并进入「编辑」而不是「图片预览」。
 */
import { SLIDE_EMU } from "./units.mjs";

export const NS = {
  a: "http://schemas.openxmlformats.org/drawingml/2006/main",
  r: "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
  p: "http://schemas.openxmlformats.org/presentationml/2006/main",
};

export const REL = {
  officeDocument: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument",
  core: "http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties",
  app: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties",
  slide: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide",
  slideMaster: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster",
  slideLayout: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout",
  notesSlide: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide",
  notesMaster: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesMaster",
  theme: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme",
  presProps: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/presProps",
  viewProps: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/viewProps",
  tableStyles: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/tableStyles",
  image: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image",
};

const HEAD = `xmlns:a="${NS.a}" xmlns:r="${NS.r}" xmlns:p="${NS.p}"`;

const EMPTY_TREE = `<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>`;

const CLR_MAP = `<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>`;

function placeholder({ id, name, type, idx, x, y, w, h, size }) {
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="${type}"${idx ? ` idx="${idx}"` : ""}/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${w}" cy="${h}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln><a:noFill/></a:ln></p:spPr><p:txBody><a:bodyPr><a:normAutofit/></a:bodyPr><a:lstStyle/><a:p><a:pPr><a:defRPr sz="${size}"/></a:pPr><a:endParaRPr lang="zh-CN"/></a:p></p:txBody></p:sp>`;
}

export function themeXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:theme xmlns:a="${NS.a}" name="Cockpit">
  <a:themeElements>
    <a:clrScheme name="Cockpit">
      <a:dk1><a:sysClr val="windowText" lastClr="111111"/></a:dk1>
      <a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>
      <a:dk2><a:srgbClr val="1B1F27"/></a:dk2>
      <a:lt2><a:srgbClr val="F2F3F5"/></a:lt2>
      <a:accent1><a:srgbClr val="2F6FED"/></a:accent1>
      <a:accent2><a:srgbClr val="12A594"/></a:accent2>
      <a:accent3><a:srgbClr val="E8A33D"/></a:accent3>
      <a:accent4><a:srgbClr val="D9534F"/></a:accent4>
      <a:accent5><a:srgbClr val="7A5AF8"/></a:accent5>
      <a:accent6><a:srgbClr val="7A8797"/></a:accent6>
      <a:hlink><a:srgbClr val="2F6FED"/></a:hlink>
      <a:folHlink><a:srgbClr val="7A5AF8"/></a:folHlink>
    </a:clrScheme>
    <a:fontScheme name="Cockpit">
      <a:majorFont><a:latin typeface="Helvetica Neue"/><a:ea typeface="PingFang SC"/><a:cs typeface=""/></a:majorFont>
      <a:minorFont><a:latin typeface="Helvetica Neue"/><a:ea typeface="PingFang SC"/><a:cs typeface=""/></a:minorFont>
    </a:fontScheme>
    <a:fmtScheme name="Cockpit">
      <a:fillStyleLst>
        <a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
        <a:gradFill rotWithShape="1"><a:gsLst><a:gs pos="0"><a:schemeClr val="phClr"><a:tint val="60000"/><a:satMod val="120000"/></a:schemeClr></a:gs><a:gs pos="100000"><a:schemeClr val="phClr"><a:shade val="80000"/><a:satMod val="120000"/></a:schemeClr></a:gs></a:gsLst><a:lin ang="5400000" scaled="0"/></a:gradFill>
        <a:gradFill rotWithShape="1"><a:gsLst><a:gs pos="0"><a:schemeClr val="phClr"><a:tint val="80000"/><a:satMod val="110000"/></a:schemeClr></a:gs><a:gs pos="100000"><a:schemeClr val="phClr"><a:shade val="88000"/><a:satMod val="105000"/></a:schemeClr></a:gs></a:gsLst><a:lin ang="5400000" scaled="0"/></a:gradFill>
      </a:fillStyleLst>
      <a:lnStyleLst>
        <a:ln w="6350" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln>
        <a:ln w="12700" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln>
        <a:ln w="19050" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln>
      </a:lnStyleLst>
      <a:effectStyleLst>
        <a:effectStyle><a:effectLst/></a:effectStyle>
        <a:effectStyle><a:effectLst/></a:effectStyle>
        <a:effectStyle><a:effectLst/></a:effectStyle>
      </a:effectStyleLst>
      <a:bgFillStyleLst>
        <a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
        <a:solidFill><a:schemeClr val="phClr"><a:tint val="95000"/><a:satMod val="170000"/></a:schemeClr></a:solidFill>
        <a:gradFill rotWithShape="1"><a:gsLst><a:gs pos="0"><a:schemeClr val="phClr"><a:tint val="93000"/><a:satMod val="150000"/></a:schemeClr></a:gs><a:gs pos="100000"><a:schemeClr val="phClr"><a:shade val="98000"/><a:satMod val="130000"/></a:schemeClr></a:gs></a:gsLst><a:lin ang="5400000" scaled="0"/></a:gradFill>
      </a:bgFillStyleLst>
    </a:fmtScheme>
  </a:themeElements>
  <a:objectDefaults/>
  <a:extraClrSchemeLst/>
</a:theme>`;
}

export function slideMasterXml({ background = "FFFFFF" } = {}) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldMaster ${HEAD}>
  <p:cSld>
    <p:bg><p:bgPr><a:solidFill><a:srgbClr val="${background}"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>
    <p:spTree>
      ${EMPTY_TREE}
      ${placeholder({ id: 2, name: "Title Placeholder 1", type: "title", x: 0, y: 0, w: SLIDE_EMU.cx, h: 914400, size: 4400 })}
      ${placeholder({ id: 3, name: "Text Placeholder 2", type: "body", idx: 1, x: 0, y: 914400, w: SLIDE_EMU.cx, h: 4572000, size: 2000 })}
    </p:spTree>
  </p:cSld>
  ${CLR_MAP}
  <p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId2"/></p:sldLayoutIdLst>
  <p:txStyles>
    <p:titleStyle><a:lvl1pPr algn="l"><a:defRPr sz="4400"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mj-lt"/><a:ea typeface="+mj-ea"/></a:defRPr></a:lvl1pPr></p:titleStyle>
    <p:bodyStyle><a:lvl1pPr><a:defRPr sz="2000"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/></a:defRPr></a:lvl1pPr></p:bodyStyle>
    <p:otherStyle><a:lvl1pPr><a:defRPr sz="1800"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/></a:defRPr></a:lvl1pPr></p:otherStyle>
  </p:txStyles>
</p:sldMaster>`;
}

export function slideLayoutXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldLayout ${HEAD} type="blank" preserve="1">
  <p:cSld name="Blank"><p:spTree>${EMPTY_TREE}</p:spTree></p:cSld>
  <p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sldLayout>`;
}

export function notesMasterXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:notesMaster ${HEAD}>
  <p:cSld>
    <p:bg><p:bgPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>
    <p:spTree>
      ${EMPTY_TREE}
      ${placeholder({ id: 2, name: "Slide Image Placeholder 1", type: "sldImg", x: 685800, y: 685800, w: 5486400, h: 3086100, size: 1200 })}
      ${placeholder({ id: 3, name: "Notes Placeholder 2", type: "body", idx: 1, x: 685800, y: 4343400, w: 5486400, h: 4104000, size: 1200 })}
    </p:spTree>
  </p:cSld>
  ${CLR_MAP}
  <p:notesStyle><a:lvl1pPr><a:defRPr sz="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/></a:defRPr></a:lvl1pPr></p:notesStyle>
</p:notesMaster>`;
}

export function slideXml(shapes) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld ${HEAD}>
  <p:cSld><p:spTree>${EMPTY_TREE}${shapes.join("")}</p:spTree></p:cSld>
  <p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sld>`;
}

const escape = (value) => String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function notesSlideXml(text) {
  const paragraphs = String(text || "").split(/\n{1,}/).filter((line) => line.trim()).map((line) => `<a:p><a:r><a:rPr lang="zh-CN" altLang="en-US" dirty="0"/><a:t>${escape(line)}</a:t></a:r></a:p>`).join("") || `<a:p><a:endParaRPr lang="zh-CN"/></a:p>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:notes ${HEAD}>
  <p:cSld><p:spTree>
    ${EMPTY_TREE}
    <p:sp><p:nvSpPr><p:cNvPr id="2" name="Slide Image Placeholder 1"/><p:cNvSpPr><a:spLocks noGrp="1" noRot="1" noChangeAspect="1"/></p:cNvSpPr><p:nvPr><p:ph type="sldImg"/></p:nvPr></p:nvSpPr><p:spPr/></p:sp>
    <p:sp><p:nvSpPr><p:cNvPr id="3" name="Notes Placeholder 2"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/>${paragraphs}</p:txBody></p:sp>
  </p:spTree></p:cSld>
  <p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:notes>`;
}

export function presentationXml({ slides, hasNotes, title = "" }) {
  const ids = slides.map((slide, index) => `<p:sldId id="${256 + index}" r:id="${slide.relId}"/>`).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation ${HEAD} saveSubsetFonts="1">
  <p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>
  ${hasNotes ? `<p:notesMasterIdLst><p:notesMasterId r:id="rId2"/></p:notesMasterIdLst>` : ""}
  <p:sldIdLst>${ids}</p:sldIdLst>
  <p:sldSz cx="${SLIDE_EMU.cx}" cy="${SLIDE_EMU.cy}"/>
  <p:notesSz cx="6858000" cy="9144000"/>
  <p:defaultTextStyle><a:lvl1pPr><a:defRPr sz="1800"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/></a:defRPr></a:lvl1pPr></p:defaultTextStyle>
</p:presentation>`;
}

export function presPropsXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentationPr ${HEAD}><p:extLst><p:ext uri="{E76CE94A-603C-4142-B9EB-6D1370010A27}"><p14:discardImageEditData xmlns:p14="http://schemas.microsoft.com/office/powerpoint/2010/main" val="0"/></p:ext><p:ext uri="{D31A062A-798A-4329-ABDD-BBA856620510}"><p14:defaultImageDpi xmlns:p14="http://schemas.microsoft.com/office/powerpoint/2010/main" val="220"/></p:ext></p:extLst></p:presentationPr>`;
}

export function viewPropsXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:viewPr ${HEAD}><p:normalViewPr><p:restoredLeft sz="15620"/><p:restoredTop sz="94660"/></p:normalViewPr><p:gridSpacing cx="76200" cy="76200"/></p:viewPr>`;
}

export function tableStylesXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:tblStyleLst xmlns:a="${NS.a}" def="{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}"/>`;
}

export function coreXml({ title = "Presentation", author = "Cockpit Harness PPT" } = {}) {
  const now = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${escape(title)}</dc:title><dc:creator>${escape(author)}</dc:creator><cp:lastModifiedBy>${escape(author)}</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`;
}

export function appXml({ slides = 0, notes = 0, title = "" } = {}) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>Cockpit Harness</Application><PresentationFormat>Widescreen</PresentationFormat><Slides>${slides}</Slides><Notes>${notes}</Notes><HiddenSlides>0</HiddenSlides><MMClips>0</MMClips><ScaleCrop>false</ScaleCrop><Company></Company><LinksUpToDate>false</LinksUpToDate><SharedDoc>false</SharedDoc><HyperlinksChanged>false</HyperlinksChanged><AppVersion>16.0000</AppVersion><TitlesOfParts><vt:vector size="1" baseType="lpstr"><vt:lpstr>${escape(title)}</vt:lpstr></vt:vector></TitlesOfParts></Properties>`;
}

export function rootRelsXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL.officeDocument}" Target="ppt/presentation.xml"/><Relationship Id="rId2" Type="${REL.core}" Target="docProps/core.xml"/><Relationship Id="rId3" Type="${REL.app}" Target="docProps/app.xml"/></Relationships>`;
}

export function relsXml(items) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${items.map((item) => `<Relationship Id="${item.id}" Type="${item.type}" Target="${item.target}"/>`).join("")}</Relationships>`;
}

/** 只给用到的图片类型声明 Default；多声明不影响打开，但会显得包不干净 */
export function contentTypesXml({ slideCount, notesCount, mediaExts = [] }) {
  const overrides = [
    ["/ppt/presentation.xml", "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"],
    ["/ppt/slideMasters/slideMaster1.xml", "application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"],
    ["/ppt/slideLayouts/slideLayout1.xml", "application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"],
    ["/ppt/notesMasters/notesMaster1.xml", "application/vnd.openxmlformats-officedocument.presentationml.notesMaster+xml"],
    ["/ppt/presProps.xml", "application/vnd.openxmlformats-officedocument.presentationml.presProps+xml"],
    ["/ppt/viewProps.xml", "application/vnd.openxmlformats-officedocument.presentationml.viewProps+xml"],
    ["/ppt/tableStyles.xml", "application/vnd.openxmlformats-officedocument.presentationml.tableStyles+xml"],
    ["/ppt/theme/theme1.xml", "application/vnd.openxmlformats-officedocument.theme+xml"],
    ["/docProps/core.xml", "application/vnd.openxmlformats-package.core-properties+xml"],
    ["/docProps/app.xml", "application/vnd.openxmlformats-officedocument.extended-properties+xml"],
  ];
  for (let index = 1; index <= slideCount; index += 1) {
    overrides.push([`/ppt/slides/slide${index}.xml`, "application/vnd.openxmlformats-officedocument.presentationml.slide+xml"]);
  }
  for (let index = 1; index <= notesCount; index += 1) {
    overrides.push([`/ppt/notesSlides/notesSlide${index}.xml`, "application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml"]);
  }
  const media = [...new Set(mediaExts)].map((ext) => {
    const type = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", bmp: "image/bmp" }[ext.toLowerCase()] || "application/octet-stream";
    return `<Default Extension="${ext}" ContentType="${type}"/>`;
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${media}${overrides.map(([part, type]) => `<Override PartName="${part}" ContentType="${type}"/>`).join("")}</Types>`;
}
