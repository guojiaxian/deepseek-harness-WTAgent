/**
 * Shipped template: government procurement (政府采购货物和服务).
 *
 * Chapter skeleton follows the standard structure of government-procurement
 * bidding documents (投标函/开标一览表/商务/技术分册) under the
 * 《政府采购货物和服务招标投标管理办法》 regime.
 * @module @deepseek-ai/dsh-bidding
 */

import type { BidTemplate } from '../types.ts'

export const GOVERNMENT_PROCUREMENT_TEMPLATE: BidTemplate = {
  id: 'government-procurement',
  name: '政府采购标书（通用）',
  description: '适用于政府采购货物与服务项目的通用章节骨架，按商务/技术分册组织。',
  category: 'government-procurement',
  chapters: [
    {
      id: 'cover',
      level: 1,
      title: '投标函及投标函附录',
      requirements: '按招标文件规定的格式完整填写投标函，法定代表人或授权代表签字并加盖公章；附录逐项响应工期、质保期、付款方式等核心承诺。',
      required: true,
    },
    {
      id: 'opening-list',
      level: 1,
      title: '开标一览表（报价表）',
      requirements: '大小写金额一致，币种明确，按招标文件要求的报价格式填写，不得缺项漏项。',
      required: true,
    },
    {
      id: 'qualification',
      level: 1,
      title: '资格证明文件',
      requirements: '营业执照、税务与社保证明、资质证书、信用记录等，均需在有效期内并加盖公章。',
      required: true,
      materialCategories: ['company-qualification', 'credit-record'],
    },
    {
      id: 'business-volume',
      level: 1,
      title: '商务部分',
      requirements: '合同条款偏离表逐条响应；交付期、地点、验收方式、付款条件明确；商务应答不得出现负偏离。',
      required: true,
      materialCategories: ['business-terms', 'contract-template'],
    },
    {
      id: 'technical',
      level: 1,
      title: '技术部分',
      requirements: '对照采购需求逐项应答；技术参数偏离表逐项列明正/负偏离；方案描述完整可执行。',
      required: true,
      materialCategories: ['technical-proposal', 'implementation-plan'],
    },
    {
      id: 'project-team',
      level: 1,
      title: '项目实施团队',
      requirements: '拟派人员一览表附职称/证书复印件；项目经理与关键岗位人员履历完整。',
      required: true,
      materialCategories: ['team-resume', 'project-team'],
    },
    {
      id: 'after-sales',
      level: 1,
      title: '售后服务方案',
      requirements: '服务承诺、响应时间、服务网点、备件供应与培训安排明确量化。',
      required: false,
      materialCategories: ['after-sales', 'service-commitment'],
    },
    {
      id: 'proof-documents',
      level: 1,
      title: '证明材料和业绩',
      requirements: '类似项目合同关键页、验收证明按招标文件要求的数量与年限提供并编制索引。',
      required: false,
      materialCategories: ['performance-proof', 'contract-performance'],
    },
    {
      id: 'other',
      level: 1,
      title: '招标文件要求的其他内容',
      requirements: '逐项核对招标文件「投标文件组成」章节，未涵盖的要求在此补充。',
      required: false,
    },
  ],
}
