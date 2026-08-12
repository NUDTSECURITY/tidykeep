#!/usr/bin/env bash
# tidykeep 一键卸载器
# 用法: bash uninstall.sh [目标项目目录] [--purge]
#   默认保留 STATE.md / LEDGER.md / scratch/（它们是项目知识）；--purge 且为本工具创建时才移除。
set -euo pipefail
command -v python3 >/dev/null 2>&1 || { echo "[tidykeep] 错误: 需要 python3"; exit 1; }

TARGET="$PWD"; PURGE=0
while [ $# -gt 0 ]; do
    case "$1" in
        --purge) PURGE=1 ;;
        -h|--help) sed -n '2,4p' "$0"; exit 0 ;;
        *) TARGET="$1" ;;
    esac
    shift
done
TARGET=$(cd "$TARGET" && pwd)
TK="$TARGET/.tidykeep"
MANIFEST="$TK/manifest"
[ -f "$MANIFEST" ] || echo "[tidykeep] 提示: 未找到安装清单，按尽力而为模式卸载"
echo "[tidykeep] 从 $TARGET 卸载"

was_created() { grep -qxF "created $1" "$MANIFEST" 2>/dev/null; }

# 移除文件中的 marker 块；若文件系本工具创建且剥离后为空则删除文件
strip_block() { # $1=相对路径 $2=begin $3=end
    local rel="$1" path="$TARGET/$1"
    [ -f "$path" ] || return 0
    TK_FILE="$path" TK_BEGIN="$2" TK_END="$3" python3 - <<'PY'
import os
path, begin, end = os.environ["TK_FILE"], os.environ["TK_BEGIN"], os.environ["TK_END"]
text = open(path, encoding="utf-8").read()
if begin in text and end in text:
    pre = text.split(begin, 1)[0]
    post = text.split(end, 1)[1]
    new = (pre.rstrip("\n") + "\n" + post.lstrip("\n")) if (pre.strip() or post.strip()) else ""
    open(path, "w", encoding="utf-8").write(new)
print("empty" if not open(path, encoding="utf-8").read().strip() else "kept")
PY
}

for spec in "AGENTS.md|<!-- tidykeep:begin -->|<!-- tidykeep:end -->" \
            "CLAUDE.md|<!-- tidykeep:begin -->|<!-- tidykeep:end -->" \
            "GEMINI.md|<!-- tidykeep:begin -->|<!-- tidykeep:end -->" \
            ".gitignore|# >>> tidykeep >>>|# <<< tidykeep <<<"; do
    rel=${spec%%|*}; rest=${spec#*|}; b=${rest%%|*}; e=${rest#*|}
    [ -f "$TARGET/$rel" ] || continue
    st=$(strip_block "$rel" "$b" "$e")
    if [ "$st" = "empty" ] && was_created "$rel"; then
        rm -f "$TARGET/$rel"
        echo "[tidykeep] 已删除 $rel（本工具创建且已无其他内容）"
    else
        echo "[tidykeep] 已移除 $rel 中的 tidykeep 块"
    fi
done

# 剥离 settings.json 中的 tidykeep hooks
SETTINGS="$TARGET/.claude/settings.json"
if [ -f "$SETTINGS" ]; then
    st=$(TK_SETTINGS="$SETTINGS" python3 - <<'PY'
import json, os
path = os.environ["TK_SETTINGS"]
try:
    data = json.load(open(path, encoding="utf-8"))
except Exception:
    print("skipped"); raise SystemExit
hooks = data.get("hooks", {})
def ours(h):
    joined = " ".join([h.get("command", "")] + list(h.get("args") or []))
    return ".tidykeep/" in joined
for event in list(hooks.keys()):
    groups = []
    for grp in hooks[event]:
        kept = [h for h in grp.get("hooks", []) if not ours(h)]
        if kept:
            grp["hooks"] = kept
            groups.append(grp)
    if groups:
        hooks[event] = groups
    else:
        del hooks[event]
if not hooks:
    data.pop("hooks", None)
if data:
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, indent=2); fh.write("\n")
    print("stripped")
else:
    print("empty")
PY
)
    if [ "$st" = "empty" ] && was_created ".claude/settings.json"; then
        rm -f "$SETTINGS"
        echo "[tidykeep] 已删除 .claude/settings.json（本工具创建且已无其他内容）"
    else
        echo "[tidykeep] settings.json 处理: $st（原始备份见 .tidykeep/backup/）"
    fi
fi

# 技能
rm -rf "$TARGET/.claude/skills/tidykeep"
echo "[tidykeep] 已移除技能 .claude/skills/tidykeep/"

# git hooksPath（仅当是本工具设置时还原）
if grep -qxF "hookspath set" "$MANIFEST" 2>/dev/null; then
    cur=$(git -C "$TARGET" config core.hooksPath 2>/dev/null || true)
    if [ "$cur" = ".tidykeep/githooks" ]; then
        git -C "$TARGET" config --unset core.hooksPath || true
        echo "[tidykeep] 已还原 git core.hooksPath"
    fi
fi

# 知识文件
SCRATCH=$(sed -n 's/^SCRATCH_DIR="\(.*\)"$/\1/p' "$TK/config" 2>/dev/null || true)
SCRATCH=${SCRATCH:-.tmp}
if [ "$PURGE" = "1" ]; then
    for f in STATE.md LEDGER.md; do
        if was_created "$f"; then rm -f "$TARGET/$f"; echo "[tidykeep] --purge 已删除 $f"; fi
    done
    rmdir "$TARGET/$SCRATCH" 2>/dev/null && echo "[tidykeep] 已删除空的 $SCRATCH/" || true
    rmdir "$TARGET/scratch" 2>/dev/null || true
else
    echo "[tidykeep] 已保留 STATE.md / LEDGER.md / $SCRATCH/（项目知识；--purge 可移除）"
fi

rm -rf "$TK"
echo "[tidykeep] 卸载完成 ✅"
