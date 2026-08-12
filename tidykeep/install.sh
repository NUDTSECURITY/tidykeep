#!/usr/bin/env bash
# tidykeep 一键安装器
# 用法: bash install.sh [目标项目目录] [--gemini] [--no-git-hooks] [--ledger-mode block|warn|off]
# 依赖: bash、python3；git 仓库可选（无 git 则跳过 git hooks 层）。
set -euo pipefail

SELF_DIR=$(cd "$(dirname "$0")" && pwd)
PAYLOAD="$SELF_DIR/payload"
[ -d "$PAYLOAD" ] || { echo "[tidykeep] 错误: 找不到 payload 目录（$PAYLOAD）"; exit 1; }
command -v python3 >/dev/null 2>&1 || { echo "[tidykeep] 错误: 需要 python3"; exit 1; }

# ---------- 参数 ----------
TARGET="$PWD"; WITH_GEMINI=0; NO_GITHOOKS=0; LEDGER_MODE=""
while [ $# -gt 0 ]; do
    case "$1" in
        --gemini) WITH_GEMINI=1 ;;
        --no-git-hooks) NO_GITHOOKS=1 ;;
        --ledger-mode) shift; LEDGER_MODE="${1:-}" ;;
        -h|--help) sed -n '2,5p' "$0"; exit 0 ;;
        *) TARGET="$1" ;;
    esac
    shift
done
TARGET=$(cd "$TARGET" && pwd)
TK="$TARGET/.tidykeep"
MANIFEST="$TK/manifest"
echo "[tidykeep] 安装到: $TARGET"

# ---------- 工具函数 ----------
record() { grep -qxF "$1" "$MANIFEST" 2>/dev/null || echo "$1" >> "$MANIFEST"; }
record_file() { # $1=created|modified  $2=相对路径（同一文件只记录首次状态）
    grep -qE "^(created|modified) $2\$" "$MANIFEST" 2>/dev/null || echo "$1 $2" >> "$MANIFEST"
}

# 在文件中插入/替换 marker 块。env: TK_BLOCK=块内容
# 参数: 文件路径  begin标记  end标记 ；stdout 输出 created|existed
upsert_block() {
    TK_FILE="$1" TK_BEGIN="$2" TK_END="$3" python3 - <<'PY'
import os
path, begin, end = os.environ["TK_FILE"], os.environ["TK_BEGIN"], os.environ["TK_END"]
content = os.environ["TK_BLOCK"].rstrip("\n")
block = begin + "\n" + content + "\n" + end + "\n"
existed = os.path.exists(path)
text = open(path, encoding="utf-8").read() if existed else ""
if begin in text and end in text:
    pre = text.split(begin, 1)[0]
    post = text.split(end, 1)[1]
    new = pre + block + post
elif text:
    sep = "" if text.endswith("\n\n") else ("\n" if text.endswith("\n") else "\n\n")
    new = text + sep + block
else:
    new = block
open(path, "w", encoding="utf-8").write(new)
print("modified" if existed else "created")
PY
}

# ---------- 1. 部署 .tidykeep/ ----------
mkdir -p "$TK/hooks" "$TK/githooks" "$TK/backup"
touch "$MANIFEST"
cp -f "$PAYLOAD/hooks/guard_stale_names.py" "$TK/hooks/"
cp -f "$PAYLOAD/hooks/stop_sync_check.py"   "$TK/hooks/"
cp -f "$PAYLOAD/githooks/pre-commit"        "$TK/githooks/"
cp -f "$PAYLOAD/githooks/commit-msg"        "$TK/githooks/"
chmod +x "$TK/githooks/pre-commit" "$TK/githooks/commit-msg" "$TK/hooks/"*.py
[ -f "$TK/config" ]    || cp "$PAYLOAD/config" "$TK/config"
[ -f "$TK/allowlist" ] || cp "$PAYLOAD/allowlist" "$TK/allowlist"
cat > "$TK/enable-githooks.sh" <<'SH'
#!/usr/bin/env bash
# 团队成员克隆仓库后执行一次，启用 tidykeep git hooks（本地配置，git 不同步）。
cd "$(dirname "$0")/.." && git config core.hooksPath .tidykeep/githooks && echo "[tidykeep] git hooks 已启用"
SH
chmod +x "$TK/enable-githooks.sh"
if [ -n "$LEDGER_MODE" ]; then
    TK_MODE="$LEDGER_MODE" TK_CFG="$TK/config" python3 - <<'PY'
import os, re
p, m = os.environ["TK_CFG"], os.environ["TK_MODE"]
s = open(p, encoding="utf-8").read()
s = re.sub(r'^ENFORCE_LEDGER=.*$', 'ENFORCE_LEDGER="%s"' % m, s, flags=re.M)
open(p, "w", encoding="utf-8").write(s)
PY
fi
echo "[tidykeep] .tidykeep/ 已部署"

# ---------- 2. 唯一入口: AGENTS.md（Codex、Kimi 原生读取）----------
export TK_BLOCK
TK_BLOCK=$(cat "$PAYLOAD/rules.md")
st=$(upsert_block "$TARGET/AGENTS.md" "<!-- tidykeep:begin -->" "<!-- tidykeep:end -->")
record_file "$st" "AGENTS.md"; echo "[tidykeep] AGENTS.md 规则块: $st"

# ---------- 3. CLAUDE.md 指针（@import 导入 AGENTS.md）----------
TK_BLOCK='# 项目规则入口（tidykeep）

本项目所有 Agent 规则统一维护于 AGENTS.md，请勿在本文件重复添加规则。以下导入其全文：

@AGENTS.md'
st=$(upsert_block "$TARGET/CLAUDE.md" "<!-- tidykeep:begin -->" "<!-- tidykeep:end -->")
record_file "$st" "CLAUDE.md"; echo "[tidykeep] CLAUDE.md 指针块: $st"

# ---------- 4. GEMINI.md 指针（可选）----------
if [ "$WITH_GEMINI" = "1" ] || [ -f "$TARGET/GEMINI.md" ]; then
    TK_BLOCK='# 项目规则入口（tidykeep）

本项目所有 Agent 规则统一维护于 AGENTS.md（tidykeep 协议）。
开始任何任务前，请先完整阅读并严格遵循 @AGENTS.md 的全部内容。'
    st=$(upsert_block "$TARGET/GEMINI.md" "<!-- tidykeep:begin -->" "<!-- tidykeep:end -->")
    record_file "$st" "GEMINI.md"; echo "[tidykeep] GEMINI.md 指针块: $st"
fi

# ---------- 5. STATE.md / LEDGER.md / scratch ----------
if [ ! -f "$TARGET/STATE.md" ]; then
    cp "$PAYLOAD/STATE.md" "$TARGET/STATE.md"; record_file created "STATE.md"
    echo "[tidykeep] STATE.md 已创建"
fi
if [ ! -f "$TARGET/LEDGER.md" ]; then
    cp "$PAYLOAD/LEDGER.md" "$TARGET/LEDGER.md"; record_file created "LEDGER.md"
    echo "[tidykeep] LEDGER.md 已创建"
fi
SCRATCH=$(sed -n 's/^SCRATCH_DIR="\(.*\)"$/\1/p' "$TK/config"); SCRATCH=${SCRATCH:-.tmp}
mkdir -p "$TARGET/$SCRATCH"
TK_BLOCK="$SCRATCH/
.tidykeep/backup/"
st=$(upsert_block "$TARGET/.gitignore" "# >>> tidykeep >>>" "# <<< tidykeep <<<")
record_file "$st" ".gitignore"

# ---------- 6. Claude Code hooks（合并进 .claude/settings.json）----------
SETTINGS="$TARGET/.claude/settings.json"
if [ -f "$SETTINGS" ] && [ ! -f "$TK/backup/settings.json.bak" ]; then
    cp "$SETTINGS" "$TK/backup/settings.json.bak"
fi
st=$(TK_SETTINGS="$SETTINGS" python3 - <<'PY'
import json, os, sys
path = os.environ["TK_SETTINGS"]
created, data = True, {}
if os.path.exists(path):
    created = False
    try:
        data = json.load(open(path, encoding="utf-8"))
    except Exception:
        sys.stderr.write("[tidykeep] 警告: 现有 settings.json 无法解析，跳过 hooks 合并\n")
        print("skipped"); sys.exit(0)
hooks = data.setdefault("hooks", {})

def has_ours(event):
    for grp in hooks.get(event, []):
        for h in grp.get("hooks", []):
            joined = " ".join([h.get("command", "")] + list(h.get("args") or []))
            if ".tidykeep/hooks/" in joined:
                return True
    return False

def handler(script, status):
    return {"type": "command", "command": "python3",
            "args": ["${CLAUDE_PROJECT_DIR}/.tidykeep/hooks/" + script],
            "timeout": 20, "statusMessage": status}

if not has_ours("PreToolUse"):
    hooks.setdefault("PreToolUse", []).extend([
        {"matcher": "Write", "hooks": [handler("guard_stale_names.py", "tidykeep: 检查文件命名")]},
        {"matcher": "Bash",  "hooks": [handler("guard_stale_names.py", "tidykeep: 检查命令")]},
    ])
if not has_ours("Stop"):
    hooks.setdefault("Stop", []).append(
        {"hooks": [handler("stop_sync_check.py", "tidykeep: 收尾检查")]})

os.makedirs(os.path.dirname(path), exist_ok=True)
with open(path, "w", encoding="utf-8") as fh:
    json.dump(data, fh, ensure_ascii=False, indent=2)
    fh.write("\n")
print("created" if created else "modified")
PY
)
[ "$st" != "skipped" ] && record_file "$st" ".claude/settings.json"
echo "[tidykeep] Claude Code hooks: $st"

# ---------- 7. tidykeep 技能 ----------
mkdir -p "$TARGET/.claude/skills/tidykeep"
cp -f "$PAYLOAD/skills/tidykeep/SKILL.md" "$TARGET/.claude/skills/tidykeep/SKILL.md"
record "skill installed"
echo "[tidykeep] 技能已安装: .claude/skills/tidykeep/"

# ---------- 8. git hooks（对 Codex / Kimi / 人类的通用强制层）----------
if [ "$NO_GITHOOKS" = "1" ]; then
    record "hookspath none"
elif git -C "$TARGET" rev-parse --git-dir >/dev/null 2>&1; then
    cur=$(git -C "$TARGET" config core.hooksPath 2>/dev/null || true)
    if [ -z "$cur" ]; then
        git -C "$TARGET" config core.hooksPath .tidykeep/githooks
        record "hookspath set"
        echo "[tidykeep] git core.hooksPath -> .tidykeep/githooks（原 .git/hooks 中的同名 hook 会被链式执行）"
    elif [ "$cur" = ".tidykeep/githooks" ]; then
        record "hookspath set"
        echo "[tidykeep] git hooks 已是 tidykeep 接管状态"
    else
        record "hookspath external"
        echo "[tidykeep] 检测到已有 core.hooksPath=$cur（如 husky），未覆盖。"
        echo "           请在 $cur/pre-commit 与 $cur/commit-msg 中各加入一行："
        echo "             bash \"\$(git rev-parse --show-toplevel)/.tidykeep/githooks/pre-commit\" \"\$@\" || exit \$?"
        echo "             bash \"\$(git rev-parse --show-toplevel)/.tidykeep/githooks/commit-msg\" \"\$@\" || exit \$?"
    fi
else
    record "hookspath nogit"
    echo "[tidykeep] 非 git 仓库：跳过 git hooks 层（建议 git init 后重跑安装）"
fi

# ---------- 完成 ----------
cat <<DONE

[tidykeep] 安装完成 ✅
覆盖矩阵:
  规则入口   AGENTS.md（Codex/Kimi 原生读取；Kimi 项目级覆盖 ~/.kimi/AGENTS.md）
  指针文件   CLAUDE.md -> @AGENTS.md$([ "$WITH_GEMINI" = "1" ] || [ -f "$TARGET/GEMINI.md" ] && printf '；GEMINI.md -> AGENTS.md')
  知识文件   STATE.md（当前设计唯一真相）/ LEDGER.md（文件台账）
  硬约束     Claude Code: PreToolUse 命名拦截+系统tmp重定向 / Stop 收尾检查(台账+.tmp残留)
             全 Agent:   git pre-commit / commit-msg（.tidykeep/githooks）

下一步（重要）:
  1. 在任一 Agent 里执行初始化扫描——Claude Code 直接说“tidykeep 初始化扫描”；
     Codex/Kimi 说“按照 AGENTS.md 的 tidykeep 协议执行初始化扫描”。
  2. 将 AGENTS.md CLAUDE.md STATE.md LEDGER.md .tidykeep .claude 提交入库；
     团队成员克隆后执行一次: bash .tidykeep/enable-githooks.sh
卸载: bash uninstall.sh [目标目录]（--purge 连 STATE/LEDGER 一并移除）
DONE
