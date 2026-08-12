#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""tidykeep PreToolUse hook
拦截三类操作：
1. Write 以"历史副本命名"（_v2/_old/_final/_backup/copy/副本…）创建文件；
2. Write / Bash 在系统临时目录（/tmp、/var/tmp、~/tmp、~/.tmp、$TMPDIR、/dev/shm）
   创建文件——一律重定向到项目内的草稿区（默认 .tmp/，随卸载与收尾检查统一管理）；
3. Bash 命令中疑似创建历史副本文件（cp/mv/touch/tee/重定向/mktemp）。
放行：路径在项目草稿区内、命中 .tidykeep/allowlist、或相应开关为 off。
Bash 扫描会跳过 heredoc 正文，避免把代码字符串里的 /tmp 误判为落盘路径。
"""
import json
import os
import re
import sys

DEFAULT_STALE = (r"([_. -](v[0-9]+|old|new|final|finalfinal|backup|bak|copy[0-9]*|dup"
                 r"|tmp|temp|deprecated|legacy|orig)[_. -]*|\([0-9]+\)|副本|旧版|备份)"
                 r"\.[A-Za-z0-9]+$")

CREATE_VERB = re.compile(r"(^|[;&|(]\s*)(cp|mv|touch|tee|install|rsync|dd|truncate)\b"
                         r"|>>?\s*\S|\bmktemp\b")


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


def read_allowlist(root):
    allow = set()
    try:
        with open(os.path.join(root, ".tidykeep", "allowlist"), encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if line and not line.startswith("#"):
                    allow.add(line)
    except OSError:
        pass
    return allow


def posix(path):
    return path.replace(os.sep, "/")


def norm(path, root):
    p = os.path.expanduser(path)
    if not os.path.isabs(p):
        p = os.path.join(root, p)
    return posix(os.path.abspath(p))


def in_project(abspath, root):
    return abspath.startswith(posix(os.path.abspath(root)).rstrip("/") + "/")


def tmp_prefixes(root):
    """系统临时目录前缀（排除项目自身所在位置，项目可能就住在 /tmp 下）。"""
    home = posix(os.path.expanduser("~"))
    pref = ["/tmp/", "/var/tmp/", "/private/tmp/", "/private/var/tmp/", "/dev/shm/",
            home + "/tmp/", home + "/.tmp/"]
    tmpdir = os.environ.get("TMPDIR")
    if tmpdir:
        pref.append(posix(os.path.abspath(os.path.expanduser(tmpdir))).rstrip("/") + "/")
    return pref


def visible_shell_lines(cmd):
    """去掉 heredoc 正文，只留真正的 shell 命令行，降低误报。"""
    out, term = [], None
    for line in cmd.split("\n"):
        if term is not None:
            if line.strip() in (term, term + ";"):
                term = None
            continue
        out.append(line)
        m = re.search(r"<<-?\s*['\"]?([A-Za-z_][A-Za-z0-9_]*)['\"]?", line)
        if m:
            term = m.group(1)
    return "\n".join(out)


def tokens(text):
    for tok in re.split(r"[\s;|&()<>]+", text):
        tok = tok.strip("'\"`").rstrip("),;:")
        if tok:
            yield tok


def deny(reason):
    print(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": reason,
        }
    }, ensure_ascii=False))
    sys.exit(0)


def main():
    try:
        data = json.load(sys.stdin)
    except Exception:
        return

    root = os.environ.get("CLAUDE_PROJECT_DIR") or data.get("cwd") or os.getcwd()
    cfg = read_config(root)
    guard_on = cfg.get("GUARD", "on").lower() != "off"
    tmp_on = cfg.get("FORBID_SYSTEM_TMP", "on").lower() != "off"
    if not guard_on and not tmp_on:
        return

    stale_re = re.compile(cfg.get("STALE_ERE", DEFAULT_STALE), re.IGNORECASE)
    scratch = cfg.get("SCRATCH_DIR", ".tmp").strip("/") or ".tmp"
    allow = read_allowlist(root)
    tmps = tmp_prefixes(root)

    def is_system_tmp(abspath):
        if in_project(abspath, root):
            return False
        return any(abspath.startswith(p) for p in tmps)

    tool = data.get("tool_name", "")
    tool_input = data.get("tool_input") or {}

    if tool == "Write":
        fp = tool_input.get("file_path") or ""
        if not fp:
            return
        ap = norm(fp, root)
        base = os.path.basename(ap)
        if tmp_on and is_system_tmp(ap):
            deny(
                "tidykeep 拦截：禁止在系统临时目录创建文件（{}）。"
                "临时/验证脚本请放在项目内的草稿区并在那里执行：{}/{} 。"
                "该目录已 gitignore、随收尾检查统一清理，不会像 /tmp 一样留下无人管理的残留。"
                "用完请立即删除。".format(fp, scratch, base)
            )
        if not in_project(ap, root):
            return  # 项目外其他位置不在本守卫职责内
        rel = ap[len(posix(os.path.abspath(root)).rstrip("/")) + 1:]
        if rel.startswith(scratch + "/") or rel.startswith(".tidykeep/") or rel in allow:
            return
        if guard_on and stale_re.search(base):
            deny(
                "tidykeep 拦截：文件名 '{}' 命中历史副本命名模式（_v2/_old/_final/_backup/copy/副本…）。"
                "请遵守 AGENTS.md 的 tidykeep 协议：直接修改原文件；参数差异用 CLI 参数或配置文件解决，"
                "不要复制脚本；确属一次性实验请放入 {}/ 目录；若该命名确实合理，"
                "请人工把路径 '{}' 加入 .tidykeep/allowlist 后重试。".format(base, scratch, rel)
            )
        return

    if tool == "Bash":
        cmd = tool_input.get("command") or ""
        if not cmd:
            return
        visible = visible_shell_lines(cmd)
        if not CREATE_VERB.search(visible):
            return

        # 3a. mktemp 默认落在系统 /tmp
        if tmp_on and re.search(r"\bmktemp\b", visible):
            p_args = re.findall(r"-p[= ]\s*(\S+)", visible)
            redirected = any(scratch in a for a in p_args) or (scratch + "/") in visible
            if not redirected:
                deny(
                    "tidykeep 拦截：mktemp 默认在系统 /tmp 创建文件。"
                    "请改用项目草稿区：mktemp -p {0}（目录已存在且已 gitignore），"
                    "或直接在 {0}/ 下创建具名脚本，用完即删。".format(scratch)
                )

        tmp_hits, stale_hits = [], []
        for tok in tokens(visible):
            if "/" not in tok and not tok.startswith("~"):
                continue
            ap = norm(tok, root)
            if tmp_on and is_system_tmp(ap) and "." in os.path.basename(ap):
                tmp_hits.append(tok)
                continue
            if guard_on and in_project(ap, root):
                rel = ap[len(posix(os.path.abspath(root)).rstrip("/")) + 1:]
                base = os.path.basename(ap)
                if rel.startswith(scratch + "/") or rel.startswith(".tidykeep/") or rel in allow:
                    continue
                if "." in base and stale_re.search(base):
                    stale_hits.append(rel)

        if tmp_hits:
            deny(
                "tidykeep 拦截：该命令疑似在系统临时目录创建文件：{}。"
                "临时/验证脚本请放在项目内草稿区 {}/ 下创建与执行（已 gitignore，收尾时统一检查清理），"
                "用完即删。".format("、".join(sorted(set(tmp_hits))), scratch)
            )
        if stale_hits:
            deny(
                "tidykeep 拦截：该命令疑似在创建历史副本文件：{}。"
                "请直接修改原文件（历史由 git 保管）；一次性实验放 {}/；"
                "误报可将路径加入 .tidykeep/allowlist 后重试。".format(
                    "、".join(sorted(set(stale_hits))), scratch)
            )


if __name__ == "__main__":
    main()
