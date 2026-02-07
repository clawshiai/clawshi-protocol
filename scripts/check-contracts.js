import solc from 'solc';
import { readFileSync } from 'fs';

console.log('='.repeat(60));
console.log('Contract Compilation Check');
console.log('='.repeat(60));
console.log('');

function compileAndCheck(name, path) {
  console.log(`Checking ${name}...`);

  try {
    const source = readFileSync(path, 'utf8');

    const sources = {
      [name + '.sol']: { content: source }
    };

    const input = {
      language: 'Solidity',
      sources,
      settings: {
        optimizer: { enabled: true, runs: 200 },
        outputSelection: {
          '*': { '*': ['abi', 'evm.bytecode.object', 'evm.gasEstimates'] }
        }
      }
    };

    function findImports(importPath) {
      try {
        let fullPath = importPath;
        // Handle various import path formats
        if (importPath.startsWith('../')) {
          fullPath = 'contracts/' + importPath.replace('../', '');
        } else if (importPath.startsWith('./')) {
          // Same directory import
          const dir = path.split('/').slice(0, -1).join('/');
          fullPath = dir + '/' + importPath.replace('./', '');
        } else if (!importPath.startsWith('contracts/')) {
          // Try contracts directory
          fullPath = 'contracts/' + importPath;
        }
        return { contents: readFileSync(fullPath, 'utf8') };
      } catch (e) {
        return { error: 'File not found: ' + importPath };
      }
    }

    const output = JSON.parse(solc.compile(JSON.stringify(input), { import: findImports }));

    // Check for errors
    if (output.errors) {
      const errors = output.errors.filter(e => e.severity === 'error');
      const warnings = output.errors.filter(e => e.severity === 'warning');

      if (errors.length > 0) {
        console.log('  ❌ ERRORS:');
        errors.forEach(e => {
          console.log('     ' + e.formattedMessage);
        });
        return { success: false, errors };
      }

      if (warnings.length > 0) {
        console.log('  ⚠️  ' + warnings.length + ' warning(s)');
      }
    }

    // Get contract info
    const contractFile = Object.keys(output.contracts).find(f => output.contracts[f][name]);
    if (contractFile && output.contracts[contractFile][name]) {
      const contract = output.contracts[contractFile][name];
      const bytecodeSize = contract.evm.bytecode.object.length / 2;

      console.log('  ✅ Compiled successfully');
      console.log('     Size: ' + (bytecodeSize / 1024).toFixed(2) + ' KB');

      // Check size limit (24KB)
      if (bytecodeSize > 24576) {
        console.log('  ⚠️  Warning: Contract exceeds 24KB limit!');
      }

      return { success: true, size: bytecodeSize };
    }

    console.log('  ❌ Contract not found in output');
    return { success: false };

  } catch (e) {
    console.log('  ❌ Error: ' + e.message);
    return { success: false, error: e.message };
  }
}

const results = [];

// Check all contracts
console.log('');
results.push({ name: 'IResolver', ...compileAndCheck('IResolver', 'contracts/interfaces/IResolver.sol') });

console.log('');
results.push({ name: 'ChainlinkResolver', ...compileAndCheck('ChainlinkResolver', 'contracts/resolvers/ChainlinkResolver.sol') });

console.log('');
results.push({ name: 'ManualResolver', ...compileAndCheck('ManualResolver', 'contracts/resolvers/ManualResolver.sol') });

console.log('');
results.push({ name: 'MarketFactory', ...compileAndCheck('MarketFactory', 'contracts/core/MarketFactory.sol') });

// Summary
console.log('');
console.log('='.repeat(60));

const passed = results.filter(r => r.success).length;
const failed = results.filter(r => !r.success).length;

if (failed === 0) {
  console.log('✅ ALL ' + passed + ' CONTRACTS PASSED');
  console.log('='.repeat(60));

  const totalSize = results.reduce((sum, r) => sum + (r.size || 0), 0);
  console.log('');
  console.log('Total bytecode: ' + (totalSize / 1024).toFixed(2) + ' KB');
  console.log('');
  console.log('Estimated deployment cost:');
  console.log('  ~0.002-0.003 ETH (at 0.1 gwei gas price)');
  console.log('');
  console.log('✅ Ready to deploy!');
} else {
  console.log('❌ ' + failed + ' CONTRACT(S) FAILED');
  console.log('='.repeat(60));
  results.filter(r => !r.success).forEach(r => {
    console.log('  - ' + r.name);
  });
  process.exit(1);
}
