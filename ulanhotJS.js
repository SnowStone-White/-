// ==UserScript==
// @name         ulanhot自动化脚本（含复习模式 v1.7.2）
// @namespace    http://tampermonkey.net/
// @version      1.7.2
// @description  自动播放视频并提供状态监控，支持拖动面板与折叠收起，复习模式支持章节标题提示等增强功能！
// @author       S·S·White
// @match        https://plat.chinahrt.cn/onlineVideo.asp*
// @grant        none
// @license      MIT
// ==/UserScript==

(function () {
    'use strict';

    let taskList = [];
    let isAutoLearning = false;
    let isReviewMode = false;
    let checkInterval;
    let videoEndEventListenerAdded = false;

    const createStatusPanel = () => {
        const panel = document.createElement('div');
        panel.id = 'autoStudyPanel';
        panel.style.cssText = 'position:fixed;top:20px;right:20px;width:420px;background:linear-gradient(to bottom right,#ffffff,#f0f0ff);border:1px solid #aaa;border-radius:10px;z-index:9999;font-size:14px;box-shadow:0 4px 20px rgba(0,0,0,0.15);font-family:Segoe UI,Arial,sans-serif;';

        panel.innerHTML = `
            <div id="autoStudyHeader" style="background:#4a90e2;color:white;padding:10px 15px;border-radius:10px 10px 0 0;display:flex;justify-content:space-between;align-items:center;cursor:move;">
                <strong style="font-size:16px;">📚 自动学习监控</strong>
                <button id="togglePanel" style="background:none;border:none;color:white;font-size:18px;cursor:pointer;">🔽</button>
            </div>
            <div id="autoStudyContent" style="padding:15px;">
                <div style="margin-bottom:8px;">当前状态: <strong id="currentStatus" style="color:#333">等待开始</strong></div>
                <div style="margin-bottom:8px;">当前章节: <span id="currentChapter" style="color:#555">未选择</span></div>
                <div style="margin-bottom:8px;">学习进度: <span id="currentProgress" style="color:#555">0%</span></div>
                <div style="margin-bottom:15px;">总进度: <span id="totalProgress" style="color:#555">0%</span></div>
                <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:15px;">
                    <button id="startAuto" style="flex:1;padding:8px 12px;background:#28a745;color:white;border:none;border-radius:5px;cursor:pointer;">▶️ 开始</button>
                    <button id="stopAuto" style="flex:1;padding:8px 12px;background:#dc3545;color:white;border:none;border-radius:5px;cursor:pointer;">⏹️ 停止</button>
                    <button id="startReview" style="flex:1;padding:8px 12px;background:#ffc107;color:white;border:none;border-radius:5px;cursor:pointer;">🔁 复习模式</button>
                </div>
                <div id="logContainer" style="max-height:180px;overflow:auto;border-top:1px solid #ccc;padding-top:10px;font-size:12px;background:#f9f9f9;border-radius:5px;"></div>
            </div>
        `;
        document.body.appendChild(panel);

        // 拖动逻辑
        const header = document.getElementById('autoStudyHeader');
        let isDragging = false, offsetX = 0, offsetY = 0;

        header.addEventListener('mousedown', e => {
            isDragging = true;
            const rect = panel.getBoundingClientRect();
            offsetX = e.clientX - rect.left;
            offsetY = e.clientY - rect.top;
        });

        document.addEventListener('mousemove', e => {
            if (!isDragging) return;
            panel.style.left = e.clientX - offsetX + 'px';
            panel.style.top = e.clientY - offsetY + 'px';
        });

        document.addEventListener('mouseup', () => {
            isDragging = false;
        });

        // 折叠逻辑
        const toggleBtn = document.getElementById('togglePanel');
        const content = document.getElementById('autoStudyContent');
        toggleBtn.addEventListener('click', () => {
            if (content.style.display === 'none') {
                content.style.display = 'block';
                toggleBtn.textContent = '🔽';
            } else {
                content.style.display = 'none';
                toggleBtn.textContent = '▶️';
            }
        });

        document.getElementById('startAuto').onclick = startAutoLearning;
        document.getElementById('stopAuto').onclick = stopAllModes;
        document.getElementById('startReview').onclick = startReviewMode;

        return {
            log: (msg, type = '') => {
                const logEl = document.getElementById('logContainer');
                const entry = document.createElement('div');
                entry.style.color = type === 'error' ? 'crimson' : type === 'warn' ? '#e67e22' : '#2c3e50';
                entry.style.marginBottom = '5px';
                entry.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
                logEl.appendChild(entry);
                logEl.scrollTop = logEl.scrollHeight;
            },
            updateStatus: text => document.getElementById('currentStatus').textContent = text,
            updateCurrentChapter: text => document.getElementById('currentChapter').textContent = text,
            updateProgress: text => document.getElementById('currentProgress').textContent = text,
            updateTotalProgress: text => document.getElementById('totalProgress').textContent = text,
        };
    };

    const panel = createStatusPanel();

    function refreshTaskList() {
        taskList = [];
        const chapters = document.querySelectorAll('.ui-kczj a');
        chapters.forEach(el => {
            const title = el.textContent.trim();
            const isCompleted = el.querySelector('i.layui-icon-ok[style*="color:green"]');
            taskList.push({ title, isCompleted: !!isCompleted, isCurrent: false, element: el });
        });
        updateTotalProgress();
    }

    function updateTotalProgress() {
        const completed = taskList.filter(t => t.isCompleted).length;
        const total = taskList.length;
        const percent = total ? ((completed / total) * 100).toFixed(2) + '%' : '0%';
        panel.updateTotalProgress(percent);
    }

    async function playCurrentVideo() {
        const video = document.querySelector('#libVideo video');
        if (video) {
            try {
                await video.play();
                panel.log('🎬 视频播放中...');
                if (isAutoLearning && !videoEndEventListenerAdded) {
                    video.addEventListener('ended', () => goToNextAutoTask());
                    videoEndEventListenerAdded = true;
                }
            } catch (e) {
                panel.log(`播放失败: ${e.message}`, 'error');
            }
        } else {
            panel.log('未找到视频元素', 'error');
        }
    }

    function updateProgress() {
        const text = document.getElementById('jd_box')?.innerText || '';
        const match = text.match(/\d+\.\d+/);
        panel.updateProgress(match ? match[0] + '%' : '0%');
    }

    function checkStatusAuto() {
        updateProgress();
        const jdText = document.getElementById('jd_box')?.innerText || '';
        if (jdText.includes('已完成') || jdText.includes('100')) {
            goToNextAutoTask();
        }
    }

    function checkStatusReview() {
        updateProgress();
        const video = document.querySelector('#libVideo video');
        const currentIdx = taskList.findIndex(t => t.isCurrent);

        if (video) {
            if (video.ended || video.currentTime >= video.duration - 0.5) {
                const nextTask = taskList[currentIdx + 1];
                panel.log(`✅ 视频播放完毕，切换到下一任务：${nextTask?.title || '未知章节'}`);
                goToNextReviewTask();
                return;
            }

            if (video.paused) {
                video.play().catch(() => {});
            }
        }

        const jdText = document.getElementById('jd_box')?.innerText || '';
        if (jdText.includes('已完成') || jdText.includes('100')) {
            const nextTask = taskList[currentIdx + 1];
            panel.log(`✅ 检测完成标识，切换到下一任务：${nextTask?.title || '未知章节'}`);
            goToNextReviewTask();
        }
    }

    function startAutoLearning() {
        stopAllModes();
        isAutoLearning = true;
        panel.updateStatus('自动学习中');
        refreshTaskList();
        const first = taskList.find(t => !t.isCompleted);
        if (first) {
            first.isCurrent = true;
            panel.updateCurrentChapter(first.title);
            first.element.click();
            setTimeout(playCurrentVideo, 3000);
            checkInterval = setInterval(checkStatusAuto, 5000);
        } else {
            panel.log('所有任务已完成');
        }
    }

    function startReviewMode() {
        stopAllModes();
        isReviewMode = true;
        panel.updateStatus('复习模式中');
        refreshTaskList();
        if (taskList.length > 0) {
            taskList.forEach((t, i) => t.isCurrent = i === 0);
            taskList[0].element.click();
            panel.updateCurrentChapter(taskList[0].title);
            setTimeout(playCurrentVideo, 3000);
            checkInterval = setInterval(checkStatusReview, 5000);
        }
    }

    function goToNextAutoTask() {
        const currentIdx = taskList.findIndex(t => t.isCurrent);
        taskList[currentIdx].isCompleted = true;
        const next = taskList.find((t, i) => !t.isCompleted && i > currentIdx);
        if (next) {
            taskList.forEach(t => t.isCurrent = false);
            next.isCurrent = true;
            next.element.click();
            panel.updateCurrentChapter(next.title);
            setTimeout(playCurrentVideo, 3000);
        } else {
            panel.log('🎉 所有视频已完成');
            stopAllModes();
        }
    }

    function goToNextReviewTask() {
        const currentIdx = taskList.findIndex(t => t.isCurrent);
        if (currentIdx < taskList.length - 1) {
            taskList.forEach(t => t.isCurrent = false);
            const next = taskList[currentIdx + 1];
            next.isCurrent = true;
            next.element.click();
            panel.updateCurrentChapter(next.title);
            setTimeout(playCurrentVideo, 3000);
        } else {
            panel.log('📘 复习完成');
            stopAllModes();
        }
    }

    function stopAllModes() {
        isAutoLearning = false;
        isReviewMode = false;
        panel.updateStatus('已停止');
        clearInterval(checkInterval);
        videoEndEventListenerAdded = false;
    }

    window.addEventListener('load', () => {
        panel.log('✅ 脚本已加载，准备就绪');
    });
})();
