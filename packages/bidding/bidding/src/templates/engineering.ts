/**
 * Shipped template: engineering construction (工程施工).
 *
 * Chapter skeleton follows the standard construction bidding structure
 * (投标函/施工组织设计/项目管理机构) under the 《招标投标法》 regime.
 * @module @deepseek-ai/dsh-bidding
 */

import type { BidTemplate } from '../types.ts'

export const ENGINEERING_TEMPLATE: BidTemplate = {
  id: 'engineering',
  name: '工程施工标书（通用）',
  description: '适用于房屋建筑与市政基础设施等工程施工投标的通用章节骨架。',
  category: 'engineering',
  chapters: [
    {
      id: 'cover',
      level: 1,
      title: '投标函及投标函附录',
      requirements: '工期、质量标准、项目经理承诺按招标文件格式填写并签字盖章。',
      required: true,
    },
    {
      id: 'opening-list',
      level: 1,
      title: '开标一览表与已标价工程量清单',
      requirements: '报价与已标价工程量清单一致；措施费、规费、税金不得作为竞争性费用缺项。',
      required: true,
    },
    {
      id: 'qualification',
      level: 1,
      title: '资格审查资料',
      requirements: '资质证书、安全生产许可证、项目经理注册建造师证书与安全生产考核合格证均在有效期内。',
      required: true,
      materialCategories: ['company-qualification', 'credit-record'],
    },
    {
      id: 'organization-design',
      level: 1,
      title: '施工组织设计',
      requirements: '施工方案与方法、进度计划（横道图/网络图）、平面布置、质量/安全/环境保证措施完整，是评标技术分的主要来源。',
      required: true,
      materialCategories: ['construction-plan', 'schedule-plan', 'quality-assurance', 'safety-plan'],
    },
    {
      id: 'project-management',
      level: 1,
      title: '项目管理机构',
      requirements: '项目经理、技术负责人及关键岗位人员配备表附证书与社保证明。',
      required: true,
      materialCategories: ['team-resume', 'project-team'],
    },
    {
      id: 'performance',
      level: 1,
      title: '类似工程业绩',
      requirements: '中标通知书或合同关键页、竣工验收证明按评分办法要求的年限与数量提供。',
      required: false,
      materialCategories: ['performance-proof', 'contract-performance'],
    },
    {
      id: 'bid-advance',
      level: 1,
      title: '拟投入本标段的主要施工设备',
      requirements: '设备名称、规格、数量、状况与进场计划表。',
      required: false,
      materialCategories: ['equipment-list'],
    },
    {
      id: 'other',
      level: 1,
      title: '招标文件规定的其他内容',
      requirements: '逐项核对招标文件「投标文件格式」章节补齐缺项。',
      required: false,
    },
  ],
}
