/**
 * Shipped template: goods procurement (货物采购).
 *
 * Chapter skeleton for equipment/goods supply bids: the technical response
 * matrix against the supply requirement list is the scoring core.
 * @module @deepseek-ai/dsh-bidding
 */

import type { BidTemplate } from '../types.ts'

export const GOODS_TEMPLATE: BidTemplate = {
  id: 'goods',
  name: '货物采购标书（通用）',
  description: '适用于设备、货物类采购项目投标的通用章节骨架，突出供货范围与技术参数应答。',
  category: 'goods',
  chapters: [
    {
      id: 'cover',
      level: 1,
      title: '投标函及投标函附录',
      requirements: '供货期、质保期、付款方式承诺按招标文件格式填写并签字盖章。',
      required: true,
    },
    {
      id: 'opening-list',
      level: 1,
      title: '开标一览表与分项报价表',
      requirements: '总价与分项价一致；供货范围、备品备件、安装调试费用归属明确。',
      required: true,
    },
    {
      id: 'qualification',
      level: 1,
      title: '资格证明文件',
      requirements: '营业执照、授权函（代理商投标）、生产许可或强制认证证书齐全有效。',
      required: true,
      materialCategories: ['company-qualification', 'authorization-letter'],
    },
    {
      id: 'supply-list',
      level: 1,
      title: '供货范围与技术规格应答',
      requirements: '对照供货清单一行一应答；技术参数正/负偏离逐项标注，星号（*）参数须完全满足。',
      required: true,
      materialCategories: ['technical-proposal', 'product-catalog'],
    },
    {
      id: 'delivery-plan',
      level: 1,
      title: '生产、运输与交付方案',
      requirements: '生产排期、运输方案、到货验收与安装调试计划完整。',
      required: true,
      materialCategories: ['delivery-plan', 'implementation-plan'],
    },
    {
      id: 'acceptance',
      level: 1,
      title: '验收与培训方案',
      requirements: '验收标准与流程对照合同约定；培训对象、内容、课时明确。',
      required: false,
      materialCategories: ['training-plan'],
    },
    {
      id: 'after-sales',
      level: 1,
      title: '售后服务与质保承诺',
      requirements: '质保期限、响应时间、维修网点、备件供应承诺量化。',
      required: true,
      materialCategories: ['after-sales', 'service-commitment'],
    },
    {
      id: 'performance',
      level: 1,
      title: '类似供货业绩',
      requirements: '合同关键页、验收报告按评分要求提供并编制索引。',
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
