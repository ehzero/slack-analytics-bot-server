#!/usr/bin/env node

/**
 * 여러 줄의 프롬프트를 한 줄의 문자열로 안전하게 변환
 * input: inp.txt
 * output: opt.txt
 * run: node escape_newlines.js < inp.txt
 */

const fs = require("fs");

function escapeNewlines(str) {
  return str
    .replace(/\\/g, "\\\\")
    .replace(/\r\n|\r|\n/g, "\\n")
    .replace(/"/g, '\\"');
}

const input = fs.readFileSync(0, "utf8");
const output = escapeNewlines(input);

fs.writeFileSync("opt.txt", `"${output}"`, "utf8");
console.log("✅ 변환 완료! 결과는 opt.txt 파일에 저장되었습니다.");
