document.addEventListener('DOMContentLoaded', () => {
    // ---- Grade Selection ----
    const gradeButtons = document.querySelectorAll('.grade-btn');
    gradeButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            gradeButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            btn.style.transform = 'scale(0.95)';
            setTimeout(() => { btn.style.transform = ''; }, 100);
        });
    });

    // ---- Date Picker ----
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    let weekOffset = 0;

    function getWeekDates(offset) {
        const today = new Date();
        const start = new Date(today);
        start.setDate(today.getDate() + offset * 7);
        return Array.from({ length: 7 }, (_, i) => {
            const d = new Date(start);
            d.setDate(start.getDate() + i);
            return d;
        });
    }

    function renderDates() {
        const scroll = document.getElementById('date-scroll');
        const dates = getWeekDates(weekOffset);
        scroll.innerHTML = '';
        dates.forEach((date, i) => {
            const card = document.createElement('div');
            card.className = 'date-card' + (i === 1 ? ' active' : '');
            card.innerHTML = `<span class="d-name">${dayNames[date.getDay()]}</span><span class="d-num">${date.getDate()}</span>`;
            card.addEventListener('click', () => {
                document.querySelectorAll('.date-card').forEach(c => c.classList.remove('active'));
                card.classList.add('active');
            });
            scroll.appendChild(card);
        });
        lucide.createIcons();
    }

    document.getElementById('prev-week').addEventListener('click', () => {
        if (weekOffset > 0) { weekOffset--; renderDates(); }
    });
    document.getElementById('next-week').addEventListener('click', () => {
        weekOffset++;
        renderDates();
    });

    renderDates();

    // ---- Time Slot Picker ----
    const TIME_SLOTS = [
        '8:00–9:00 AM',
        '9:00–10:00 AM',
        '10:00–11:00 AM',
        '11:00–12:00 PM',
        '2:00–3:00 PM',
        '3:00–4:00 PM',
        '4:00–5:00 PM',
        '5:00–6:00 PM',
        '6:00–7:00 PM',
    ];

    function renderTimeSlots() {
        const grid = document.getElementById('time-slots-grid');
        grid.innerHTML = '';
        TIME_SLOTS.forEach((slot, i) => {
            const btn = document.createElement('button');
            btn.className = 'time-slot-btn' + (i === 6 ? ' active' : '');
            btn.textContent = slot;
            btn.addEventListener('click', () => {
                document.querySelectorAll('.time-slot-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
            });
            grid.appendChild(btn);
        });
    }

    renderTimeSlots();

    // ---- Enroll Button -> Success Page ----
    const enrollBtn = document.querySelector('.enroll-btn');

    enrollBtn.addEventListener('click', () => {
        // Button press micro-interaction
        enrollBtn.style.transform = 'scale(0.96)';
        setTimeout(() => { enrollBtn.style.transform = ''; }, 150);

        // Navigate to success page
        window.location.href = 'success.html';
    });

    // ---- Input Focus ----
    document.querySelectorAll('input').forEach(input => {
        input.addEventListener('focus', () => {
            const label = input.parentElement.querySelector('label');
            if (label) label.style.color = '#2563eb';
        });
        input.addEventListener('blur', () => {
            const label = input.parentElement.querySelector('label');
            if (label) label.style.color = '#64748b';
        });
    });
});
