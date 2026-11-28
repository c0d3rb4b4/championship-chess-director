import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const directory = "test-results/provider-screenshots";
const commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const report = [
  "# Match-day rehearsal",
  "",
  `Tested commit \`${commit}\`. All images and clips use fixture inputs.`,
  "",
  "| Programme | 1920 × 1080 | 1280 × 720 |",
  "|---|---|---|",
];

// Check the media itself so a missing scene, truncated encode or wrong viewport fails the job.
function media(file, width, height) {
  const probe = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_streams", "-of", "json",
    join(directory, file)], { encoding: "utf8" }));
  const [video] = probe.streams;
  if (probe.streams.length !== 1 || video.codec_type !== "video" || video.width !== width || video.height !== height ||
      (file.endsWith(".mp4") && (video.codec_name !== "h264" || !(Number(video.duration) > 0)))) {
    throw Error(`Unexpected media format for ${file}`);
  }
  if (file.startsWith("videos/auto-")) {
    // Chromium can encode an 800px trace frame in the corner of a nominal 720p video.
    // The programme canvas is dark all the way to its lower-right edge.
    const corner = execFileSync("ffmpeg", ["-v","error","-ss","0.2","-i",join(directory,file),"-frames:v","1",
      "-vf","crop=4:4:iw-4:ih-4,scale=1:1","-pix_fmt","rgb24","-f","rawvideo","-threads","1","pipe:1"]);
    if (corner.length !== 3 || Math.max(...corner) > 70) throw Error(`Incomplete programme viewport in ${file}`);
  }
  return `[${file.split("/").pop()}](${file})`;
}

for (const [label, stem] of [
  ["Countdown with previous replay", "g4/waiting-ply-2"],
  ["Countdown without predecessor", "g4/game-1-no-predecessor"],
  ["Unattended comparison", "unattended/comparison"],
  ["Unattended game in numbers", "unattended/numbers"],
  ["Settled live variation", "unattended/spotlight"],
  ["Released live position", "g2/live"],
  ["Conclusion", "g3/result"],
  ["Game in numbers", "g3/numbers"],
  ["Time used", "g3/time"],
  ["Evaluation history", "g3/evaluation"],
  ["Mid-replay promotion", "g3/replay"],
]) {
  report.push(`| ${label} | ${media(stem + "-1080.jpg", 1920, 1080)} | ${media(stem + "-720.jpg", 1280, 720)} |`);
}

report.push("", "## Silent transitions", "");
for (const name of ["auto-rotation", "auto-entrance", "auto-return", "auto-interrupt", "g4-opening-takeover", "g2-confirmed-result", "g3-result-to-recap"]) {
  report.push("- " + media(`videos/${name}-720p.mp4`, 1280, 720));
}

report.push("", "## Eligible release to browser paint (ms)", "",
  "| Transition | Delay | 1080p | 720p | Preview |", "|---|---|---|---|---|");
for (const [label, folder] of [["Opening", "g4"], ["Final move and result", "g5/result"]]) {
  for (const delay of [0, 60]) {
    const file = `${folder}/paint-D${delay}.json`;
    const { hd, sd, preview } = JSON.parse(readFileSync(join(directory, file), "utf8"));
    if (![hd, sd, preview].every(ms => Number.isFinite(ms) && ms >= 0 && ms < 500)) {
      throw Error(`Missing or late paint in ${file}`);
    }
    report.push(`| [${label}](${file}) | ${delay} s | ${hd} | ${sd} | ${preview} |`);
  }
}
for (const seconds of [0, 60]) {
  const file = `unattended/interrupt-D${seconds}.json`;
  const rows = JSON.parse(readFileSync(join(directory,file),"utf8"));
  if (new Set(rows.map(r => r.label)).size !== 11) throw Error("Incomplete live interrupt matrix");
  for (const row of rows) {
    if (row.paints.length !== 3 || row.paints.some(ms => !(ms >= 0 && ms < 500))) throw Error("Late live move");
    report.push(`| [${row.label}](${file}) | ${seconds} s | ${row.paints.join(" | ")} |`);
  }
}
const { first, second } = JSON.parse(readFileSync(join(directory,"unattended/endurance.json"),"utf8"));
if (first.timelineMs !== 8*3600000 || first.digest !== second.digest) throw Error("Endurance replay mismatch");
report.push("", `[Eight-hour accelerated replays and resource samples](unattended/endurance.json). Minimum rolling large-board share ${(first.minimumLargeShare*100).toFixed(1)}%.`);
writeFileSync(join(directory, "MATCH-DAY.md"), report.join("\n") + "\n");
