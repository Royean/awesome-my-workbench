import fs from 'node:fs';

export const hubRoleCatalog = {
  source: null,
  roles: [
    {
      "id": "product-manager",
      "name": "产品经理",
      "group": "开发协作",
      "description": "把想法拆成可执行、可验收的需求。",
      "responsibilities": [
        "定义目标和范围",
        "安排优先级",
        "明确验收标准"
      ],
      "skills": []
    },
    {
      "id": "ui-ux-designer",
      "name": "UI/UX 设计师",
      "group": "开发协作",
      "description": "设计用户流程、界面和交互状态。",
      "responsibilities": [
        "设计用户流程",
        "制定界面规格",
        "检查交互一致性"
      ],
      "skills": []
    },
    {
      "id": "developer",
      "name": "开发工程师",
      "group": "开发协作",
      "description": "实现、维护并验证软件功能。",
      "responsibilities": [
        "技术方案与实现",
        "工程自测",
        "代码评审与交接"
      ],
      "skills": []
    },
    {
      "id": "test-acceptance-engineer",
      "name": "测试验收工程师",
      "group": "开发协作",
      "description": "独立执行验收、记录缺陷并复测。",
      "responsibilities": [
        "制定测试计划",
        "执行独立验收",
        "缺陷复测"
      ],
      "skills": []
    },
    {
      "id": "work-assistant",
      "name": "工作助理",
      "group": "工作协作",
      "description": "维护项目上下文，跟进进度和交接。",
      "responsibilities": [
        "整理项目背景",
        "汇总工作进度",
        "维护交接索引"
      ],
      "skills": []
    },
    {
      "id": "investment-advisor",
      "name": "投资顾问",
      "group": "生活与资产",
      "description": "维护金融和固定资产资料，支持估值与复盘。",
      "responsibilities": [
        "资产台账",
        "估值复盘",
        "现金流与维护安排"
      ],
      "skills": []
    },
    {
      "id": "family-doctor",
      "name": "家庭医生",
      "group": "生活与资产",
      "description": "整理健康档案、就诊准备与随访信息。",
      "responsibilities": [
        "健康报告解读",
        "就诊准备",
        "复查与随访整理"
      ],
      "skills": []
    },
    {
      "id": "life-butler",
      "name": "生活管家",
      "group": "生活与资产",
      "description": "安排并跟进个人生活事务。",
      "responsibilities": [
        "生活事务计划",
        "信息整理",
        "执行跟进"
      ],
      "skills": []
    },
    {
      "id": "content-planner",
      "name": "内容策划",
      "group": "内容与媒体",
      "description": "负责选题、内容策略和脚本。",
      "responsibilities": [
        "选题与创意",
        "文稿写作",
        "视频脚本"
      ],
      "skills": []
    },
    {
      "id": "social-media-agent",
      "name": "社媒运营",
      "group": "内容与媒体",
      "description": "负责平台适配、排期、草稿和运营反馈。",
      "responsibilities": [
        "平台适配",
        "排期与草稿管理",
        "运营复盘"
      ],
      "skills": []
    },
    {
      "id": "video-editor",
      "name": "视频剪辑师",
      "group": "内容与媒体",
      "description": "负责素材、剪辑、音频字幕与工程交接。",
      "responsibilities": [
        "素材和剪辑",
        "音频与字幕",
        "导出和交接"
      ],
      "skills": []
    }
  ]
};

export function loadHubRoleCatalog(file = process.env.WORKBENCH_ROLE_CATALOG_FILE) {
  if (!file) return hubRoleCatalog;
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size > 1024 * 1024) throw new Error();
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    const validText = value => typeof value === 'string' && value.length <= 500;
    if (!data || !Array.isArray(data.roles) || !data.roles.length || data.roles.length > 100) throw new Error();
    const validLink = value => {
      if (!value) return true;
      try {
        const url = new URL(value);
        return validText(value) && url.protocol === 'https:' && !url.username && !url.password && !url.search;
      } catch {
        return false;
      }
    };
    if (data.source && (!validLink(data.source.url) || !['repo', 'revision', 'status'].every(key => data.source[key] === undefined || validText(data.source[key])))) throw new Error();
    if (data.sharedInstructions !== undefined && (typeof data.sharedInstructions !== 'string' || data.sharedInstructions.length > 80000)) throw new Error();
    const ids = new Set();
    for (const role of data.roles) {
      if (!/^[a-z0-9-]{1,64}$/.test(role.id) || ids.has(role.id)) throw new Error();
      if (![role.name, role.group, role.description].every(validText)) throw new Error();
      if (!Array.isArray(role.skills) || role.skills.length > 30) throw new Error();
      if (!validLink(role.sourceUrl)) throw new Error();
      if (role.instructions !== undefined && (typeof role.instructions !== 'string' || role.instructions.length > 40000)) throw new Error();
      if (role.responsibilities !== undefined && (!Array.isArray(role.responsibilities) || role.responsibilities.length > 30 || !role.responsibilities.every(validText))) throw new Error();
      if (role.skills.some(skill => !skill || !validText(skill.name) || !validLink(skill.sourceUrl) ||
          (skill.description !== undefined && !validText(skill.description)) ||
          (skill.status !== undefined && !validText(skill.status)))) throw new Error();
      ids.add(role.id);
    }
    return data;
  } catch {
    throw new Error('角色目录配置文件无法读取，请检查路径、权限与格式');
  }
}
