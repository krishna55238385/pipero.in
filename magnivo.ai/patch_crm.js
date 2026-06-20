const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'src', 'app', 'actions', 'crm.ts');
let content = fs.readFileSync(filePath, 'utf8');

// 1. Patch updateDealStage
const matchStage = /async function updateDealStage\(dealId: string, newStage: string\) \{([\s\S]*?)revalidatePath\('\/deals'\)\s+revalidatePath\('\/'\)\s+return \{ success: true \}\r?\n\}/;
if (matchStage.test(content)) {
    const patch = `
  revalidatePath('/deals')
  revalidatePath('/')

  // Trigger Automation: deal_won / stage_changed
  if (newStage.toLowerCase() === 'won') {
      executeAutomationFlows('deal_won', 'deal', dealId, { status: newStage }).catch(console.error)
  }
  executeAutomationFlows('stage_changed', 'deal', dealId, { status: newStage }).catch(console.error)

  return { success: true }
}`;
    content = content.replace(matchStage, `async function updateDealStage(dealId: string, newStage: string) {$1${patch}\n}`);
    console.log('Patched updateDealStage');
} else {
    console.log('Target for updateDealStage not found or already patched');
}

// 2. Patch updateDeal
const matchUpdate = /async function updateDeal\(dealId: string, fields: \{[\s\S]*?\} \{([\s\S]*?)revalidatePath\('\/deals'\)\s+revalidatePath\('\/'\)\s+return \{ success: true \}\r?\n\}/;
if (matchUpdate.test(content)) {
    const patch = `
  revalidatePath('/deals')
  revalidatePath('/')

  // Trigger Automation: field_updated / status_changed
  if (fields.status) {
      if (fields.status.toLowerCase() === 'won') {
          executeAutomationFlows('deal_won', 'deal', dealId, fields).catch(console.error)
      }
      executeAutomationFlows('stage_changed', 'deal', dealId, fields).catch(console.error)
  }

  return { success: true }
}`;
    content = content.replace(matchUpdate, (fullMatch, group1) => {
        return fullMatch.replace(/revalidatePath\('\/deals'\)\s+revalidatePath\('\/'\)\s+return \{ success: true \}/, patch);
    });
    console.log('Patched updateDeal');
} else {
    console.log('Target for updateDeal not found or already patched');
}

fs.writeFileSync(filePath, content);
