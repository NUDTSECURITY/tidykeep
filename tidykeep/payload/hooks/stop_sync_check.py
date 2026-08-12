#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""tidykeep Stop hook
Claude 准备结束回合时做两项收尾检查：
1. 台账同步：git 工作区有代码/文档改动，但 LEDGER.md / STATE.md 未更新（受 ENFORCE_LEDGER 控制）；
2. 草稿区残留：项目草稿区（默认 .tmp/）里还留着验证脚本没删（受 CHECK_TMP_LEFTOVER 控制）。
ENFORCE_LEDGER=block 时阻止收工一次（每会话最多一次），否则注入提醒后放行。
用 stop_hook_active 与每会话标记文件双重防死循环。
"""
import json
import os
import subprocess
import sys
import tempfile

LEDGER_FILES = {"LEDGER.md", "STATE.md"}
POINTER_FILES = {"AGENTS.md", "CLAUDE.md", "GEMINI.md"}

TAIL = ("完成后正常结束即可（本会话此检查只强制一次）。"
        "若确有理由维持现状（如纯格式化、脚本需跨任务保留），请向用户简要说明。")


def read_config(root):
    cfg = {}
    try:
        with open(os.path.join(root, ".tidykeep", "config"), encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, val = line.split("=", 1)
                val = val.strip()
                if len(val) >= 2 and val[0] == val[-1] and val[0] in "\"'":
                    val = val[1:-1]
                cfg[key.strip()] = val
    except OSError:
        pass
    return cfg


def changed_entries(root):
    """返回 [(状态码, 相对路径)]；非 git 仓库返回 None。"""
    try:
        out = subprocess.run(
            ["git", "-C", root, "status", "--porcelain"],
            capture_output=True, text=True, timeout=10,
        )
    except Exception:
        return None
    if out.returncode != 0:
        return None
    entries = []
    for line in out.stdout.splitlines():
        if len(line) < 4:
            continue
        code = line[:2]
        path = line[3:].strip()
        if " -> " in path:  # rename: 取新路径
            path = path.split(" -> ", 1)[1]
        entries.append((code, path.strip('"')))
    return entries


def scratch_leftovers(root, scratch, limit=8):
    base = os.path.join(root, scratch)
    found = []
    for dirpath, _dirnames, filenames in os.walk(base):
        for name in filenames:
            if name in (".gitkeep", ".gitignore", "README.md"):
                continue
            rel = os.path.relpath(os.path.join(dirpath, name), root)
            found.append(rel.replace(os.sep, "/"))
            if len(found) > limit:
                return found
    return found


def main():
    try:
        data = json.load(sys.stdin)
    except Exception:
        return

    if data.get("stop_hook_active"):
        return  # 已在 Stop-hook 触发的追加回合里，放行防死循环

    root = os.environ.get("CLAUDE_PROJECT_DIR") or data.get("cwd") or os.getcwd()
    cfg = read_config(root)
    mode = cfg.get("ENFORCE_LEDGER", "block").lower()
    check_tmp = cfg.get("CHECK_TMP_LEFTOVER", "on").lower() != "off"
    scratch = cfg.get("SCRATCH_DIR", ".tmp").strip("/") or ".tmp"
    if mode == "off" and not check_tmp:
        return

    session = data.get("session_id") or "nosession"
    flag = os.path.join(tempfile.gettempdir(), "tidykeep-stop-" + session)
    if os.path.exists(flag):
        return  # 本会话已强制过一次

    issues = []

    # ---- 检查 1：台账同步 ----
    if mode != "off":
        entries = changed_entries(root)
        if entries:
            code_exts = set(cfg.get("CODE_EXTS", "").split())
            doc_exts = set(cfg.get("DOC_EXTS", "md rst txt adoc").split())
            watched = code_exts | doc_exts
            work_changed = ledger_changed = False
            for code, path in entries:
                base = os.path.basename(path)
                if base in LEDGER_FILES:
                    if code != "??":  # 未跟踪的台账=刚安装未初始化，不算“本次已同步”
                        ledger_changed = True
                    continue
                if path.startswith(scratch + "/") or path.startswith(".tidykeep/") \
                        or path.startswith(".claude/") or base in POINTER_FILES:
                    continue
                ext = base.rsplit(".", 1)[-1].lower() if "." in base else ""
                if ext in watched:
                    work_changed = True
            if work_changed and not ledger_changed:
                issues.append(
                    "源码/文档已改动，但 LEDGER.md / STATE.md 未同步——请把本次完成项移入"
                    " LEDGER.md 的 DONE（附今天日期）、登记新 TODO、刷新『最后核对』；"
                    "设计有变化则更新 STATE.md 并把被取代的决策标记 superseded，"
                    "删除的文件登记进墓地。"
                )

    # ---- 检查 2：草稿区残留 ----
    if check_tmp:
        leftovers = scratch_leftovers(root, scratch)
        if leftovers:
            shown = "、".join(leftovers[:8]) + ("…" if len(leftovers) > 8 else "")
            issues.append(
                "草稿区 {}/ 仍有 {} 个残留文件（{}）——已完成使命的临时/验证脚本请删除；"
                "确需保留请说明原因。".format(scratch, len(leftovers), shown)
            )

    if not issues:
        return

    reason = "tidykeep 收尾检查：" + " ".join(
        "({}) {}".format(i + 1, s) for i, s in enumerate(issues)
    ) + " " + TAIL

    if mode == "block":
        try:
            with open(flag, "w") as fh:
                fh.write("1")
        except OSError:
            pass
        print(json.dumps({"decision": "block", "reason": reason}, ensure_ascii=False))
    else:
        print(json.dumps({
            "hookSpecificOutput": {
                "hookEventName": "Stop",
                "additionalContext": reason,
            }
        }, ensure_ascii=False))


if __name__ == "__main__":
    main()
