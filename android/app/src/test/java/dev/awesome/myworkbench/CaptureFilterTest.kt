package dev.awesome.myworkbench

import org.junit.Assert.*
import org.junit.Test

class CaptureFilterTest {
    @Test fun paymentTemplatesAreAccepted() {
        assertTrue(CaptureFilter.accepts("com.eg.android.AlipayGphone", "支付成功", "向虚构商店付款12.34元"))
        assertTrue(CaptureFilter.accepts("com.tencent.mm", "微信支付", "付款金额 ￥12.34"))
        assertTrue(CaptureFilter.accepts("cmb.pb", "账户变动通知", "您账户支出人民币100.00"))
    }
    @Test fun privateMessagesAndOtpNeverEnterTheQueue() {
        assertFalse(CaptureFilter.accepts("com.tencent.mm", "虚构好友", "给你转账12.34元"))
        assertFalse(CaptureFilter.accepts("com.tencent.mm", "微信支付", "付款12.34元", messaging = true))
        assertFalse(CaptureFilter.accepts("com.eg.android.AlipayGphone", "支付验证码", "付款12.34元 验证码123456"))
        assertFalse(CaptureFilter.accepts("cmb.pb", "交易通知", "付款12.34元 one-time password 123456"))
        assertFalse(CaptureFilter.accepts("cmb.pb", "优惠通知", "支付12.34元立减5元"))
    }
    @Test fun unrelatedOrAmbiguousNotificationsAreRejected() {
        assertFalse(CaptureFilter.accepts("com.eg.android.AlipayGphone", "虚构好友", "给你转账12.34元"))
        assertFalse(CaptureFilter.accepts("invalid.package", "支付成功", "12.34元"))
        assertFalse(CaptureFilter.accepts("com.eg.android.AlipayGphone", "支付成功", "点击查看金额"))
        assertFalse(CaptureFilter.accepts("com.eg.android.AlipayGphone", "每日账单", "12.34元"))
    }
}
