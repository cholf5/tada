/**
 * 界面语言：中文 / English。
 *
 * 语言选择只保存在本机（localStorage），不参与同步：同一份数据的展示语言
 * 应该由正在使用这台设备的人决定，没必要跨端覆盖。
 *
 * 默认「跟随系统」：只看浏览器首选语言，zh 开头用中文，其余一律英文。
 * 没有 window（测试 / SSR）时固定中文，跟仓库默认文案保持一致。
 */

export type Lang = 'zh' | 'en';
export type LangMode = 'system' | Lang;

/** 与 index.html 内联脚本里的键保持一致；改这里记得同步改那边。 */
const STORAGE_KEY = 'tada.lang';

export type MessageVars = Record<string, string | number>;

const zh = {
  /* 通用 */
  'common.reload': '重新加载',
  'common.close': '关闭',
  'common.closeMenu': '关闭菜单',
  'common.saved': '已保存',
  'common.add': '添加',
  'common.delete': '删除',
  'common.listName': '列表名称',
  'common.unknownList': '未知列表',

  /* 侧栏 / 导航 */
  'nav.today': '今天',
  'nav.all': '全部',
  'nav.completed': '已完成',
  'nav.settings': '设置',
  'sidebar.nav': '导航',
  'sidebar.lists': '列表',
  'sidebar.newList': '新建列表',

  /* 顶栏 */
  'topbar.openMenu': '打开菜单',
  'topbar.search': '搜索任务',
  'topbar.searchPlaceholder': '搜索任务…',
  'topbar.clearSearch': '清空搜索',

  /* 启动 / 崩溃兜底 */
  'app.sessionExpired': '凭证失效，请重新配对',
  'app.dbOpenFailed': '无法打开本地数据库',
  'app.loading': '正在加载本地数据…',
  'errors.boundaryTitle': '界面遇到了一点问题',
  'errors.boundaryHint':
    '本地数据仍然保存在这台设备上。重新加载通常就能恢复；如果反复出现，请重新加载后到设置导出一份备份再反馈。',

  /* 视图 */
  'today.count': '{count} 个到期',
  'today.emptyTitle': '今天没有到期的任务',
  'today.emptyHint': '给任务设置截止日期，它就会出现在这里。',
  'today.overdue': '逾期',

  'all.count': '{count} 个未完成',
  'all.emptyTitle': '没有未完成的任务',
  'all.emptyHint': '所有事情都处理完了，或者还没有开始。',

  'completed.count': '{count} 个',
  'completed.emptyTitle': '还没有已完成的任务',
  'completed.emptyHint': '完成的任务会归档到这里，可以随时恢复。',

  'search.title': '搜索 “{query}”',
  'search.count': '{count} 个结果',
  'search.emptyTitle': '没有匹配的任务',
  'search.emptyHint': '换个关键词试试，标题和备注都会被搜索。',

  'list.missingTitle': '列表不存在',
  'list.missingHint': '它可能已在其他设备上删除。',
  'list.backToToday': '回到今天',
  'list.deleteConfirm': '删除列表「{name}」？列表内的任务会一起隐藏。',
  'list.changeColor': '修改列表颜色',
  'list.delete': '删除列表',
  'list.colorGroup': '列表颜色',
  'list.emptyTitle': '这个列表还没有任务',
  'list.emptyHint': '在上面的输入框写点什么，回车就能创建。',

  'empty.noListsTitle': '还没有列表',
  'empty.noListsHint': '列表用来收纳任务，先创建一个吧。',

  'quickAdd.aria': '添加任务',
  'quickAdd.placeholder': '添加任务，回车创建',

  /* 任务行 / 详情 */
  'task.drag': '拖拽排序',
  'task.markDone': '标记为完成',
  'task.markUndone': '标记为未完成',
  'task.titleLabel': '任务标题',
  'task.parentTooltip': '所属父任务：{name}',
  'task.subtaskProgress': '子任务 {done}/{total} 已完成',
  'task.more': '更多操作',
  'task.rename': '重命名',
  'task.moveTo': '移动到',
  'task.delete': '删除任务',
  'task.deleteConfirm': '删除任务「{title}」？',

  'detail.title': '任务详情',
  'detail.dialogLabel': '任务详情',
  'detail.subtaskTitle': '子任务',
  'detail.parent': '父任务',
  'detail.parentDeleted': '已删除',
  'detail.notes': '备注',
  'detail.notesPlaceholder': '备注…',
  'detail.subtasks': '子任务',
  'detail.markSubtaskDone': '标记子任务为完成',
  'detail.markSubtaskUndone': '标记子任务为未完成',
  'detail.deleteSubtask': '删除子任务',
  'detail.deleteSubtaskConfirmNamed': '删除子任务「{title}」？',
  'detail.deleteSubtaskConfirm': '删除这个子任务？',
  'detail.deleteTaskConfirm': '删除这项任务及其子任务？',
  'detail.addSubtask': '添加子任务',
  'detail.addSubtaskPlaceholder': '添加子任务，回车创建',
  'detail.dueDate': '截止日期',
  'detail.list': '所属列表',
  'detail.cascadeConfirm': '还有 {count} 个未完成的子任务，一并标记为完成？',

  /* 同步状态 */
  'sync.unpaired': '仅本机',
  'sync.offline': '离线',
  'sync.syncing': '同步中',
  'sync.synced': '已同步',
  'sync.error': '同步失败',
  'sync.tooltip': '{label}：{error}',

  /* 设置 */
  'settings.appearance': '外观',
  'settings.appearanceHint': '「跟随系统」随设备自动切换；手动选择只影响这台设备。',
  'settings.themeGroup': '外观模式',
  'theme.system': '跟随系统',
  'theme.light': '日间',
  'theme.dark': '夜间',

  'settings.language': '语言',
  'settings.languageHint': '「跟随系统」按浏览器语言自动选择；手动选择只影响这台设备。',
  'settings.languageGroup': '界面语言',
  'settings.langSystem': '跟随系统',

  'settings.localData': '本地数据',
  'settings.persistenceGranted':
    '已申请持久化存储，浏览器会尽量保留本地数据。仍建议定期导出备份。',
  'settings.persistenceDenied':
    '浏览器未授予持久化存储：清理站点数据或空间紧张时可能丢失。请定期导出备份。',
  'settings.persistenceUnsupported':
    '当前浏览器不支持持久化申请。清理站点数据会丢失本地数据，请定期导出备份。',
  'settings.export': '导出备份',
  'settings.backupHint':
    '备份是 JSON 文件，包含列表和任务（含已删除墓碑），不包含配对 token。',
  'settings.exported': '已导出 {file}',

  'settings.deviceName': '设备名',
  'settings.deviceNameHint':
    '配对时登记到中继；连接后修改只影响本机显示，不会更新服务端记录。',

  'settings.relay': '中继',
  'settings.relayConnected': '已连接，多端同步在后台进行。',
  'settings.relayDisconnected': '未连接。数据只保存在这台设备上，连接后可多端同步。',
  'settings.lastSync': '上次同步',
  'settings.pending': '待同步改动',
  'settings.pendingCount': '{count} 条',
  'settings.quarantined': '不合法数据',
  'settings.quarantinedHint':
    '不合法数据 {count} 条，已跳过。数据仍保留在本地，修正后会重新同步。',
  'settings.clearQuarantine': '清除提示',
  'settings.cursor': '同步游标',
  'settings.pairingFootnote':
    '配对码由中继一次性签发，10 分钟内有效。不连接也可以正常使用，数据只保存在本机。',
  'settings.syncNow': '立即同步',
  'settings.syncing': '同步中…',
  'settings.reseed': '重新上传本地数据',
  'settings.reseedDone': '已加入 {count} 条',
  'settings.unpair': '解除配对',
  'settings.unpairConfirm':
    '解除配对？本地数据会保留，之后仍可照常使用；重新配对后才能继续多端同步。',
  'settings.reseedFootnote':
    '「重新上传本地数据」会把本地所有未删除的行重新排队推送，用于换到一台空服务器后补推。解除配对只清除本机的 token；任务数据仍保留在本地与中继上。',

  /* 配对表单 */
  'pairing.code': '配对码',
  'pairing.codePlaceholder': '例如 A1B2C3D4E5',
  'pairing.deviceName': '设备名',
  'pairing.codeRequired': '请输入完整的配对码',
  'pairing.nameRequired': '请填写设备名',
  'pairing.codeInvalid': '配对码无效或已过期',
  'pairing.httpError': '连接失败（HTTP {status}）',
  'pairing.failed': '连接失败，请重试',
  'pairing.connecting': '正在连接…',
  'pairing.connect': '连接中继',

  /* 实例品牌 */
  'branding.title': '实例品牌',
  'branding.hint':
    '名称和图标保存在中继上，对所有连接的设备生效；离线设备下次连接后更新。',
  'branding.appName': '应用名称',
  'branding.nameEmpty': '应用名称不能为空',
  'branding.icon': '应用图标',
  'branding.iconHint':
    '选一个内置图标，或上传自己的正方形图片；保存时会转成 512×512 PNG 存到中继。经典对勾可以改底色和图形颜色。',
  'branding.pendingHint': '新图标将在保存后生效',
  'branding.iconPreview': '应用图标预览',
  'branding.preview': '预览',
  'branding.current': '当前',
  'branding.builtinGroup': '内置图标',
  'branding.plate': '底色',
  'branding.plateAria': '经典对勾底色',
  'branding.mark': '图形',
  'branding.markAria': '经典对勾图形颜色',
  'branding.swap': '交换',
  'branding.paletteGroup': '经典对勾配色',
  'branding.contrast': '底色和图形颜色的对比度是 {ratio}:1',
  'branding.contrastLow': '，小尺寸可能看不清。',
  'branding.contrastOk': '。',
  'branding.chooseIcon': '选择应用图标',
  'branding.cancel': '取消选择',
  'branding.restoreDefault': '恢复默认图标',
  'branding.saving': '保存中…',
  'branding.generating': '生成中…',
  'branding.save': '保存',
  'branding.homeScreenHint':
    '已添加到主屏幕的应用需要删除后重新添加，名字和图标才会更新。',
  'branding.errorGenerate': '无法生成图标',
  'branding.errorReadImage': '无法读取图片',
  'branding.errorReadBuiltin': '无法读取内置图标',
  'branding.errorUnauthorized': '凭证失效，请重新配对',
  'branding.errorNetwork': '无法连接服务器',
  'branding.errorInvalid': '名称或图片不符合要求',
  'branding.errorSave': '保存失败',

  'branding.label.signet': '签名火漆',
  'branding.label.seal': '火漆印',
  'branding.label.notebook': '笔记本',
  'branding.label.ribbon': '纸与丝带',
  'branding.label.enamel': '珐琅勾',
  'branding.label.classic': '经典对勾',
  'branding.hint.default': '默认',
  'branding.hint.classic': '可改色',
  'branding.preset.goldInk': '金底墨勾',
  'branding.preset.navyGold': '深蓝金勾',
  'branding.preset.blueGold': '品牌蓝金勾',
  'branding.preset.blueWhite': '品牌蓝白勾',

  /* 颜色名称 */
  'colors.default': '默认',
  'colors.red': '红色',
  'colors.orange': '橙色',
  'colors.yellow': '黄色',
  'colors.green': '绿色',
  'colors.blue': '蓝色',
  'colors.indigo': '靛蓝',
  'colors.purple': '紫色',
  'colors.gray': '灰色',

  /* 日期 */
  'dates.today': '今天',
  'dates.tomorrow': '明天',
  'dates.yesterday': '昨天',
  'dates.neverSynced': '尚未同步',

  /* 错误文案 */
  'errors.timeout': '请求超时，请检查网络后重试',
  'errors.network': '无法连接服务器，请检查网络',
  'errors.dbLocked':
    '本地数据库打开超时：可能被其他 Tada 标签页占用。请关闭其他标签页后重试。',
  'errors.imageTooLarge': '图片不能超过 5 MB',
  'errors.readImage': '无法读取图片',
  'errors.unsupportedImage': '当前浏览器不支持图片处理',
  'errors.readBuiltin': '无法读取内置图标',
  'errors.builtinTooLarge': '内置图标超过 512 KiB',
  'errors.generateIcon': '无法生成图标',
  'errors.iconTooLarge': '生成的图标超过 512 KiB，请换一张更简单的图片',
} as const;

export type MessageKey = keyof typeof zh;

const en: Record<MessageKey, string> = {
  /* 通用 */
  'common.reload': 'Reload',
  'common.close': 'Close',
  'common.closeMenu': 'Close menu',
  'common.saved': 'Saved',
  'common.add': 'Add',
  'common.delete': 'Delete',
  'common.listName': 'List name',
  'common.unknownList': 'Unknown list',

  /* 侧栏 / 导航 */
  'nav.today': 'Today',
  'nav.all': 'All',
  'nav.completed': 'Completed',
  'nav.settings': 'Settings',
  'sidebar.nav': 'Navigation',
  'sidebar.lists': 'Lists',
  'sidebar.newList': 'New list',

  /* 顶栏 */
  'topbar.openMenu': 'Open menu',
  'topbar.search': 'Search tasks',
  'topbar.searchPlaceholder': 'Search tasks…',
  'topbar.clearSearch': 'Clear search',

  /* 启动 / 崩溃兜底 */
  'app.sessionExpired': 'Session expired, pair this device again',
  'app.dbOpenFailed': 'Could not open the local database',
  'app.loading': 'Loading local data…',
  'errors.boundaryTitle': 'Something went wrong',
  'errors.boundaryHint':
    'Your local data is still on this device. Reloading usually fixes it; if it keeps happening, reload, export a backup from Settings, and report it.',

  /* 视图 */
  'today.count': '{count} due',
  'today.emptyTitle': 'Nothing due today',
  'today.emptyHint': 'Give a task a due date and it will show up here.',
  'today.overdue': 'Overdue',

  'all.count': '{count} open',
  'all.emptyTitle': 'Nothing left to do',
  'all.emptyHint': 'Everything is done, or nothing has been added yet.',

  'completed.count': '{count} done',
  'completed.emptyTitle': 'No completed tasks yet',
  'completed.emptyHint': 'Completed tasks are archived here and can be restored anytime.',

  'search.title': 'Search “{query}”',
  'search.count': '{count} found',
  'search.emptyTitle': 'No matching tasks',
  'search.emptyHint': 'Try another keyword. Titles and notes are both searched.',

  'list.missingTitle': 'List not found',
  'list.missingHint': 'It may have been deleted on another device.',
  'list.backToToday': 'Back to Today',
  'list.deleteConfirm': 'Delete the list “{name}”? Its tasks will be hidden too.',
  'list.changeColor': 'Change list color',
  'list.delete': 'Delete list',
  'list.colorGroup': 'List colors',
  'list.emptyTitle': 'This list is empty',
  'list.emptyHint': 'Type above and press Enter to add a task.',

  'empty.noListsTitle': 'No lists yet',
  'empty.noListsHint': 'Lists hold your tasks. Create one to get started.',

  'quickAdd.aria': 'Add a task',
  'quickAdd.placeholder': 'Add a task, press Enter',

  /* 任务行 / 详情 */
  'task.drag': 'Drag to reorder',
  'task.markDone': 'Mark as done',
  'task.markUndone': 'Mark as not done',
  'task.titleLabel': 'Task title',
  'task.parentTooltip': 'Parent task: {name}',
  'task.subtaskProgress': 'Subtasks {done}/{total} done',
  'task.more': 'More actions',
  'task.rename': 'Rename',
  'task.moveTo': 'Move to',
  'task.delete': 'Delete task',
  'task.deleteConfirm': 'Delete the task “{title}”?',

  'detail.title': 'Task details',
  'detail.dialogLabel': 'Task details',
  'detail.subtaskTitle': 'Subtask',
  'detail.parent': 'Parent task',
  'detail.parentDeleted': 'Deleted',
  'detail.notes': 'Notes',
  'detail.notesPlaceholder': 'Notes…',
  'detail.subtasks': 'Subtasks',
  'detail.markSubtaskDone': 'Mark subtask as done',
  'detail.markSubtaskUndone': 'Mark subtask as not done',
  'detail.deleteSubtask': 'Delete subtask',
  'detail.deleteSubtaskConfirmNamed': 'Delete the subtask “{title}”?',
  'detail.deleteSubtaskConfirm': 'Delete this subtask?',
  'detail.deleteTaskConfirm': 'Delete this task and its subtasks?',
  'detail.addSubtask': 'Add a subtask',
  'detail.addSubtaskPlaceholder': 'Add a subtask, press Enter',
  'detail.dueDate': 'Due date',
  'detail.list': 'List',
  'detail.cascadeConfirm':
    'There are still unfinished subtasks ({count}). Mark them done too?',

  /* 同步状态 */
  'sync.unpaired': 'Local only',
  'sync.offline': 'Offline',
  'sync.syncing': 'Syncing',
  'sync.synced': 'Synced',
  'sync.error': 'Sync failed',
  'sync.tooltip': '{label}: {error}',

  /* 设置 */
  'settings.appearance': 'Appearance',
  'settings.appearanceHint':
    'System follows the device; a manual choice only affects this device.',
  'settings.themeGroup': 'Theme mode',
  'theme.system': 'System',
  'theme.light': 'Light',
  'theme.dark': 'Dark',

  'settings.language': 'Language',
  'settings.languageHint':
    'System follows the browser language; a manual choice only affects this device.',
  'settings.languageGroup': 'Interface language',
  'settings.langSystem': 'System',

  'settings.localData': 'Local data',
  'settings.persistenceGranted':
    'Persistent storage is granted, so the browser will try to keep local data. Still export a backup regularly.',
  'settings.persistenceDenied':
    'The browser denied persistent storage; local data may be lost when site data is cleared or space runs out. Export backups regularly.',
  'settings.persistenceUnsupported':
    'This browser does not support persistent storage. Clearing site data will delete local data, so export backups regularly.',
  'settings.export': 'Export backup',
  'settings.backupHint':
    'The backup is a JSON file with lists and tasks (including deleted tombstones), without the pairing token.',
  'settings.exported': 'Exported {file}',

  'settings.deviceName': 'Device name',
  'settings.deviceNameHint':
    'Registered with the relay when pairing; changing it later only affects this device and does not update the server record.',

  'settings.relay': 'Relay',
  'settings.relayConnected': 'Connected. Multi-device sync runs in the background.',
  'settings.relayDisconnected':
    'Not connected. Data stays on this device; connect to sync across devices.',
  'settings.lastSync': 'Last sync',
  'settings.pending': 'Pending changes',
  'settings.pendingCount': '{count}',
  'settings.quarantined': 'Invalid data',
  'settings.quarantinedHint':
    'Invalid records: {count}. They were skipped but stay on this device, and sync again once fixed.',
  'settings.clearQuarantine': 'Dismiss',
  'settings.cursor': 'Sync cursor',
  'settings.pairingFootnote':
    'The relay issues a one-time pairing code valid for 10 minutes. The app works fine without a relay, with data kept on this device only.',
  'settings.syncNow': 'Sync now',
  'settings.syncing': 'Syncing…',
  'settings.reseed': 'Re-upload local data',
  'settings.reseedDone': 'Queued {count}',
  'settings.unpair': 'Unpair',
  'settings.unpairConfirm':
    'Unpair? Local data stays and the app keeps working; pair again to resume multi-device sync.',
  'settings.reseedFootnote':
    'Re-upload queues every non-deleted local row for push, useful after switching to an empty relay. Unpair only clears the token on this device; task data stays both locally and on the relay.',

  /* 配对表单 */
  'pairing.code': 'Pairing code',
  'pairing.codePlaceholder': 'e.g. A1B2C3D4E5',
  'pairing.deviceName': 'Device name',
  'pairing.codeRequired': 'Enter the full pairing code',
  'pairing.nameRequired': 'Enter a device name',
  'pairing.codeInvalid': 'The pairing code is invalid or expired',
  'pairing.httpError': 'Connection failed (HTTP {status})',
  'pairing.failed': 'Connection failed, try again',
  'pairing.connecting': 'Connecting…',
  'pairing.connect': 'Connect relay',

  /* 实例品牌 */
  'branding.title': 'Instance branding',
  'branding.hint':
    'The name and icon are stored on the relay and apply to every connected device; offline devices update on their next connection.',
  'branding.appName': 'App name',
  'branding.nameEmpty': 'The app name cannot be empty',
  'branding.icon': 'App icon',
  'branding.iconHint':
    'Pick a built-in icon or upload your own square image; it is converted to a 512×512 PNG and stored on the relay. The classic check lets you change its background and mark colors.',
  'branding.pendingHint': 'The new icon takes effect after saving',
  'branding.iconPreview': 'App icon preview',
  'branding.preview': 'Preview',
  'branding.current': 'Current',
  'branding.builtinGroup': 'Built-in icons',
  'branding.plate': 'Background',
  'branding.plateAria': 'Classic check background color',
  'branding.mark': 'Mark',
  'branding.markAria': 'Classic check mark color',
  'branding.swap': 'Swap',
  'branding.paletteGroup': 'Classic check palettes',
  'branding.contrast': 'Background and mark contrast is {ratio}:1',
  'branding.contrastLow': ', which may be hard to read at small sizes.',
  'branding.contrastOk': '.',
  'branding.chooseIcon': 'Choose an app icon',
  'branding.cancel': 'Clear selection',
  'branding.restoreDefault': 'Restore default icon',
  'branding.saving': 'Saving…',
  'branding.generating': 'Generating…',
  'branding.save': 'Save',
  'branding.homeScreenHint':
    'Apps already added to the home screen must be removed and added again to pick up a new name or icon.',
  'branding.errorGenerate': 'Could not generate the icon',
  'branding.errorReadImage': 'Could not read the image',
  'branding.errorReadBuiltin': 'Could not read the built-in icon',
  'branding.errorUnauthorized': 'Session expired, pair this device again',
  'branding.errorNetwork': 'Could not reach the server',
  'branding.errorInvalid': 'The name or image does not meet the requirements',
  'branding.errorSave': 'Save failed',

  'branding.label.signet': 'Wax signet',
  'branding.label.seal': 'Wax seal',
  'branding.label.notebook': 'Notebook',
  'branding.label.ribbon': 'Paper and ribbon',
  'branding.label.enamel': 'Enamel check',
  'branding.label.classic': 'Classic check',
  'branding.hint.default': 'Default',
  'branding.hint.classic': 'Recolorable',
  'branding.preset.goldInk': 'Gold plate, ink mark',
  'branding.preset.navyGold': 'Navy plate, gold mark',
  'branding.preset.blueGold': 'Brand blue plate, gold mark',
  'branding.preset.blueWhite': 'Brand blue plate, white mark',

  /* 颜色名称 */
  'colors.default': 'Default',
  'colors.red': 'Red',
  'colors.orange': 'Orange',
  'colors.yellow': 'Yellow',
  'colors.green': 'Green',
  'colors.blue': 'Blue',
  'colors.indigo': 'Indigo',
  'colors.purple': 'Purple',
  'colors.gray': 'Gray',

  /* 日期 */
  'dates.today': 'Today',
  'dates.tomorrow': 'Tomorrow',
  'dates.yesterday': 'Yesterday',
  'dates.neverSynced': 'Not synced yet',

  /* 错误文案 */
  'errors.timeout': 'Request timed out. Check your connection and try again.',
  'errors.network': 'Could not reach the server. Check your connection.',
  'errors.dbLocked':
    'Opening the local database timed out, possibly because another Tada tab is using it. Close other tabs and try again.',
  'errors.imageTooLarge': 'The image must be under 5 MB',
  'errors.readImage': 'Could not read the image',
  'errors.unsupportedImage': 'This browser cannot process images',
  'errors.readBuiltin': 'Could not read the built-in icon',
  'errors.builtinTooLarge': 'The built-in icon exceeds 512 KiB',
  'errors.generateIcon': 'Could not generate the icon',
  'errors.iconTooLarge': 'The generated icon exceeds 512 KiB. Try a simpler image.',
};

/** 两种语言的完整词表；导出给测试做占位符一致性检查。 */
export const MESSAGES: Readonly<Record<Lang, Readonly<Record<MessageKey, string>>>> = {
  zh,
  en,
};

/* ------------------------------------------------------------------ *
 * 持久化：模式只存本机
 * ------------------------------------------------------------------ */

type ReadableStorage = Pick<Storage, 'getItem'>;
type WritableStorage = Pick<Storage, 'setItem'>;

function defaultStorage(): (ReadableStorage & WritableStorage) | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    // 部分浏览器的隐私模式会直接在访问 localStorage 时抛错
    return null;
  }
}

function isLangMode(value: unknown): value is LangMode {
  return value === 'system' || value === 'zh' || value === 'en';
}

/** 读取本机保存的模式；没有、读不到或值不合法时回退到跟随系统。 */
export function readStoredLangMode(
  storage: ReadableStorage | null = defaultStorage(),
): LangMode {
  try {
    const value = storage?.getItem(STORAGE_KEY);
    return isLangMode(value) ? value : 'system';
  } catch {
    return 'system';
  }
}

/** 记住选择；写失败（隐私模式、配额满）不影响本次生效。 */
export function writeStoredLangMode(
  mode: LangMode,
  storage: WritableStorage | null = defaultStorage(),
): void {
  try {
    storage?.setItem(STORAGE_KEY, mode);
  } catch {
    // 忽略：选择记不住只是下次回到默认，不应该打断当前操作
  }
}

/* ------------------------------------------------------------------ *
 * 语言解析
 * ------------------------------------------------------------------ */

/**
 * 浏览器首选语言。只有明确以 zh 开头才用中文，其余（包括读不到）按英文处理；
 * 没有 window 时固定中文，保证测试和 SSR 的默认文案稳定。
 */
export function detectSystemLang(): Lang {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return 'zh';
  const tag = navigator.languages?.[0] ?? navigator.language;
  if (!tag) return 'zh';
  return /^zh\b/i.test(tag) ? 'zh' : 'en';
}

export function resolveLang(mode: LangMode): Lang {
  return mode === 'system' ? detectSystemLang() : mode;
}

/** 把语言同步到 <html lang>，屏幕阅读器和搜索引擎都靠它。 */
export interface LangRoot {
  lang: string;
}

export function applyLangToDocument(
  lang: Lang = getLang(),
  root: LangRoot | null = typeof document === 'undefined' ? null : document.documentElement,
): void {
  if (!root) return;
  root.lang = lang === 'zh' ? 'zh-CN' : 'en';
}

/* ------------------------------------------------------------------ *
 * 当前状态与订阅
 * ------------------------------------------------------------------ */

let currentMode: LangMode = readStoredLangMode();
let currentLang: Lang = resolveLang(currentMode);
const listeners = new Set<() => void>();

export function getLang(): Lang {
  return currentLang;
}

export function getLangMode(): LangMode {
  return currentMode;
}

export function subscribeLang(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 保存到本机并立即生效；实际语言没变时不触发重渲染。 */
export function setLangMode(mode: LangMode): void {
  writeStoredLangMode(mode);
  currentMode = mode;
  const next = resolveLang(mode);
  const changed = next !== currentLang;
  currentLang = next;
  applyLangToDocument(next);
  if (changed) {
    for (const listener of listeners) listener();
  }
}

/* ------------------------------------------------------------------ *
 * 翻译
 * ------------------------------------------------------------------ */

function interpolate(template: string, vars?: MessageVars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => {
    if (!Object.prototype.hasOwnProperty.call(vars, name)) return whole;
    return String(vars[name]);
  });
}

export function translate(lang: Lang, key: MessageKey, vars?: MessageVars): string {
  return interpolate(MESSAGES[lang][key], vars);
}

/** 非组件代码（错误构造、confirm）使用的便捷入口：始终按当前语言翻译。 */
export function t(key: MessageKey, vars?: MessageVars): string {
  return translate(currentLang, key, vars);
}
