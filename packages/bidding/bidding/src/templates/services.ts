/**
 * Shipped template: services procurement (服务类).
 *
 * Chapter skeleton for consulting, operation & maintenance, and other
 * service bids: the service plan and staffing are the scoring core.
 * @module @deepseek-ai/dsh-bidding
 */

import type { BidTemplate } from '../types.ts'

export const SERVICES_TEMPLATE: BidTemplate = {
  id: 'services',
  name: '服务类标书（通用）',
  description: '适用于咨询、运维、运营等服务项目投标的通用章节骨架，突出服务方案与人员配置。',
  category: 'services',
  chapters: [
    {
      id: 'cover',
      level: 1,
      title: '投标函及投标函附录',
      requirements: '服务期、驻场承诺、付款方式按招标文件格式填写并签字盖章。',
      required: true,
    },
    {
      id: 'opening-list',
      level: 1,
      title: '开标一览表（报价表）',
      requirements: '人天单价与总价口径一致；费用构成不含招标文件禁止的收费项。',
      required: true,
    },
    {
      id: 'qualification',
      level: 1,
      title: '资格证明文件',
      requirements: '营业执照、行业资质、认证证书、信用记录齐全有效。',
      required: true,
      materialCategories: ['company-qualification', 'credit-record'],
    },
    {
      id: 'service-plan',
      level: 1,
      title: '服务方案',
      requirements: '服务目标、内容与流程、实施步骤、里程碑与交付物对照采购需求逐项应答。',
      required: true,
      materialCategories: ['technical-proposal', 'implementation-plan'],
    },
    {
      id: 'staffing',
      level: 1,
      title: '人员配置与团队简历',
      requirements: '拟派人员一览表附证书与社保证明；项目经理与关键岗位不得兼任冲突项目。',
      required: true,
      materialCategories: ['team-resume', 'project-team'],
    },
    {
      id: 'sla',
      level: 1,
      title: '服务承诺（SLA）与质量保证',
      requirements: '响应时间、解决时限、可用率等指标量化，违约赔偿口径明确。',
      required: true,
      materialCategories: ['service-commitment', 'quality-assurance'],
    },
    {
      id: 'transition',
      level: 1,
      title: '过渡期与应急预案',
      requirements: '进场交接计划、应急响应机制与升级路径完整。',
      required: false,
      materialCategories: ['contingency-plan'],
    },
    {
      id: 'performance',
      level: 1,
      title: '类似服务业绩',
      requirements: '合同关键页、用户评价按评分要求提供并编制索引。',
      required: false,
      materialCategories: ['performance-proof', 'contract-performance'],
    },
    {
      id: 'other',
      level: 1,
      title: '招标文件要求的其他内容',
      requirements: '逐项核对投标文件组成清单补齐缺项。',
      required: false,
    },
  ],
}
