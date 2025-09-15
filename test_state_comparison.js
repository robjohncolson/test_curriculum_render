// Test the state comparison logic
console.log('Testing state comparison logic...\n');

// Mock the key functions
const mockQRKeyboard = {
    generateSyncCode: function(user) {
        // Simulate generating a sync code (in real implementation this creates a hash)
        return user === 'student1' ? '123456' : '654321';
    },

    finishAlreadyInSync: function() {
        console.log('✅ finishAlreadyInSync called - would show "Already in sync" modal');
    },

    currentStudent: null
};

// Test case 1: States match (already in sync)
console.log('Test 1: Student and teacher states match');
const parsed1 = {
    type: 'INIT',
    user: 'student1',
    state: '123456'  // Same as what generateSyncCode would return
};

if (parsed1.type === 'INIT') {
    mockQRKeyboard.currentStudent = parsed1.user;
    const teacherState = mockQRKeyboard.generateSyncCode(parsed1.user);

    console.log(`Student state: ${parsed1.state}`);
    console.log(`Teacher state: ${teacherState}`);

    if (parsed1.state === teacherState) {
        console.log('✅ States match - no sync needed');
        mockQRKeyboard.finishAlreadyInSync();
    } else {
        console.log('❌ States differ - would proceed with sync');
    }
}

console.log('\n' + '='.repeat(50) + '\n');

// Test case 2: States differ (need sync)
console.log('Test 2: Student and teacher states differ');
const parsed2 = {
    type: 'INIT',
    user: 'student1',
    state: '999999'  // Different from what generateSyncCode would return
};

if (parsed2.type === 'INIT') {
    mockQRKeyboard.currentStudent = parsed2.user;
    const teacherState = mockQRKeyboard.generateSyncCode(parsed2.user);

    console.log(`Student state: ${parsed2.state}`);
    console.log(`Teacher state: ${teacherState}`);

    if (parsed2.state === teacherState) {
        console.log('✅ States match - no sync needed');
        mockQRKeyboard.finishAlreadyInSync();
    } else {
        console.log('❌ States differ - would proceed with sync');
    }
}

console.log('\n🎉 State comparison logic test completed!');
