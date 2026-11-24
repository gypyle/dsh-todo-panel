# dsh-todo-panel

English | [中文](#中文)

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) bundle that adds a **Todos** panel to the Web UI sidebar.

- Record todo items in a composer; each item can carry an optional due time.
- Mark items done (and restore them); done items are kept until deleted.
- Live time hints: items past their due time are shown in the error color with an "Overdue by …" label, items due within a day in the warning color, today/tomorrow items with their clock time.
- Right-click any todo (also the ContextMenu key or Shift+F10) and choose **Execute in workspace**: pick a workspace and a new conversation opens there with that todo — deadline included — as a ready-to-send prompt.
- Filters: All / Active / Done.
- Items are stored on this machine in a JSON file under the DSH home directory — `.dsh/dsh-todo-panel/items.json` (atomic writes; reads are sanitized and capped). The Host half serves it over a same-origin API, so the list follows the app across restarts and changing local ports, in any browser that opens the GUI. No model requests are sent.

The panel is registered through the `sidebar.panellist` slot (the sidebar icon) and the keyed `main` slot (the page), so it appears beside the shipped panels and follows the host theme and language (zh / en).

## Install

Once the package is on npm:

```bash
dsh plugin --profile web add @guoyle/dsh-todo-panel
```

While in development, install the local directory through **Plugins → Add plugin** in the app.

## 中文

为 DeepSeek Harness 提供**待办事项**侧栏面板的插件。

- 在输入区记录待办事项，可为每一条设置截止时间。
- 勾选标注已办，也可以恢复为未办；已办事项保留在列表中，删除才移除。
- 实时时间提示：已逾期的事项用错误色标注「已逾期 …」，一天内到期的用警告色，今天/明天到期的事项显示具体钟点。
- 右击任意待办（键盘：ContextMenu 键或 Shift+F10）选择**在工作空间中执行**：从子菜单挑一个工作区，即在该工作区新建会话，并把该待办（含截止时间）作为待发送的提示词。
- 提供全部 / 未办 / 已办筛选。
- 数据以 JSON 文件保存在本机的 DSH 目录 `.dsh/dsh-todo-panel/items.json`（原子写入；读取有清洗和条数上限）。Host 半通过同源 API 提供读写，因此重启应用、更换本地端口后列表依然保留，任何打开界面的浏览器看到的都是同一份数据。不会发起模型请求。

面板通过 `sidebar.panellist` 插槽（侧栏图标）和 `main` 键控插槽（页面）注册，与内置面板并列显示，并跟随宿主主题与语言（zh / en）。
